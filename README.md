# Node.js Live Feed

[![CI](https://github.com/pancakebaker/nodejs-live-feed/actions/workflows/validation.yml/badge.svg)](https://github.com/pancakebaker/nodejs-live-feed/actions/workflows/validation.yml)

Standalone Node.js/TypeScript Live Feed service for the Distributed Bidding Auction Platform.

## Responsibility

Live Feed consumes integration events from RabbitMQ, applies idempotency and aggregate-version
protection, maintains a Redis projection, and publishes auction updates through Socket.IO. It also
provides authenticated admin and diagnostics surfaces, including activity, history, NDJSON, and
runtime diagnostics endpoints.

Authoritative auction and bid state remains owned by the Bidding Service. Redis is Live Feed
projection/runtime state, not authoritative auction persistence, and this service does not own or
access Bidding's PostgreSQL database. The Laravel/React client and other consumers receive live
updates through this service; authorization/admission checks continue to call Bidding's internal
endpoint.

### Tenant-wide admin activity

Authorized SystemAdministrator sessions may subscribe to `admin:activity:subscribe`. The service
derives the room from the trusted session: tenant-scoped sessions join
`admin:tenant-activity:{tenantId}`, while the existing global SystemAdministrator session joins
`admin:live-feed` for intentional cross-tenant operations visibility. Any tenant value supplied by
the browser is ignored. `admin:activity:unsubscribe` leaves the same server-selected room.

The `admin:activity:delta` event currently carries only `BidAccepted` and `AuctionPurchased`
activity. It includes the validated envelope identity and timestamp alongside the existing safe
socket payload:

```json
{
  "eventId": "<envelope event id>",
  "eventType": "BidAccepted",
  "tenantId": "<trusted tenant id>",
  "auctionId": "<auction id>",
  "occurredAtUtc": "2026-09-16T10:00:00.000Z",
  "aggregateVersion": 12,
  "payload": "<existing safe socket payload>"
}
```

`eventId` and `occurredAtUtc` come from the validated RabbitMQ integration envelope. This channel
is for live deltas only, not historical reporting: consumers must obtain an authoritative activity
snapshot initially and after reconnect. Existing auction-room subscriptions and their events are
unchanged, and no bidder profile data is added.

## Event compatibility

`contracts/fixtures/v1` contains copied golden compatibility baselines originating from the DBAP
integration contracts for `BidAccepted`, `AuctionClosed`, and `WinnerSelected`. The contract tests
load these files locally, so validation never depends on the source monorepo. `v1` is the current
wire baseline; breaking changes require a new fixture version rather than silently editing v1.
Independent npm packaging and version distribution are intentionally deferred until repository
boundaries are established.

## Local setup

### Prerequisites and configuration

Install Node.js 24.x, RabbitMQ, and Redis. The service consumes the
`auction.events` RabbitMQ exchange and uses Redis for projection state and
duplicate/stale-event protection. The Bidding Service is also required when
the service performs its internal admission checks.

From a fresh clone, create the local environment before starting the service:

```powershell
Copy-Item .env.example .env
```

On Unix/macOS, use `cp .env.example .env`. `.env.example` contains harmless
local placeholders and the exact variable names. The important settings are:

| Setting | Purpose | Local default/requirement |
| --- | --- | --- |
| `PORT` | HTTP and Socket.IO port | `3001` |
| `CLIENT_ORIGIN` | Explicit credentialed Laravel browser origin | `http://localhost:8000` |
| `RABBITMQ_URL` | RabbitMQ connection | local RabbitMQ at `localhost:5672` |
| `RABBITMQ_EXCHANGE` | Consumed exchange | `auction.events` |
| `LIVE_FEED_RABBITMQ_QUEUE` | Consumer queue | `live-feed.bid-events` |
| `REDIS_URL` | Projection/idempotency store | `redis://localhost:6379` |
| `SYSTEM_ADMIN_TOKEN_PUBLIC_KEY_PATH` | Laravel admin public key | `config/system-admin-public.pem` |
| `SYSTEM_ADMIN_TOKEN_PUBLIC_KEYS` | Optional `kid=path` key ring | empty unless used |
| `BIDDING_SERVICE_INTERNAL_URL` | Internal Bidding admission endpoint | `http://localhost:5001` |
| `LIVE_FEED_ADMIN_SESSION_SECRET` | Signs the admin session cookie | required for local admin pages; never commit it |

Optional history database settings are needed only for the history migration
and history/diagnostic features. The live projection does not require
`LIVE_FEED_DATABASE_URL`.

### Install, validate, and run

Install dependencies and validate:

```text
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

The formatter command currently reports the inherited 62-file source baseline; it is retained for
visibility and is not a blocking CI step until a separate formatting-only cleanup is approved.
Standalone CI provisions RabbitMQ and Redis and runs the full suite. The PostgreSQL history test is
intentionally skipped there unless `LIVE_FEED_DATABASE_URL` and a compatible database are supplied.

Run `npm run dev` for the service. It builds the admin bundle and starts the
service at `http://localhost:3001`; `GET http://localhost:3001/health` is the
health check. The authenticated diagnostics page is
`http://localhost:3001/admin/live-feed`. Use
`npm run watch:auction -- <auction-id>` only for the development observer.
`npm run migrate:history` applies the optional history migration when
`LIVE_FEED_DATABASE_URL` is configured.

RabbitMQ management UI and credentials are supplied by the infrastructure
repository. This service does not create Bidding application schemas or seed
auction data.

### System administrator public key

Node verifies Laravel's dedicated Live Feed SystemAdministrator assertion with
the public key selected by `SYSTEM_ADMIN_TOKEN_PUBLIC_KEY_PATH`, or by the
optional `SYSTEM_ADMIN_TOKEN_PUBLIC_KEYS` `kid=path` registry. Laravel keeps
the private key at `storage/keys/system-admin-private.pem`; Node receives
only the matching public key at `config/system-admin-public.pem`.

From the Laravel repository directory, provision the pair safely with:

```powershell
$laravelPrivate = "storage/keys/system-admin-private.pem"
$nodePublic = "..\nodejs-live-feed\config\system-admin-public.pem"
New-Item -ItemType Directory -Path (Split-Path -Parent $laravelPrivate) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $nodePublic) -Force | Out-Null
if (-not (Test-Path $laravelPrivate)) {
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $laravelPrivate
}
openssl pkey -in $laravelPrivate -pubout -out $nodePublic
```

Do not overwrite an existing private key without explicitly deciding to
rotate it. Never copy the private key into this repository or expose it to a
browser. Production deployments should mount the public key through their
configuration/secret-management process.

### Laravel browser handoff

The Laravel admin application uses the configured `CLIENT_ORIGIN` (default
`http://localhost:8000`) for a credentialed browser handoff. Laravel first
exchanges its dedicated SystemAdministrator assertion server-to-server, then the
browser requests the returned Node URL with `credentials: 'include'` and the
explicit `mode=fetch` query parameter. Node returns `204 No Content` and sets
the host-only, HttpOnly `live_feed_admin` cookie with `SameSite=Lax`, `Path=/`,
`Max-Age=900`, and `Secure` in production; no JWT or cookie value is exposed
to JavaScript. Normal top-level navigation without `mode=fetch` keeps the
existing redirect to `/admin/live-feed`.

The token exchange is `POST /admin/auth/system-token` with the
SystemAdministrator JWT in the `Authorization: Bearer` header and no request
body. A valid assertion uses `RS256`, `iss=dbap-system-admin`,
`aud=live-feed-admin`, `kid=system-admin-development-1`,
`role=SystemAdministrator`, the `livefeed.admin` permission, valid `iat`/`exp`
and unique `jti`, plus an optional validated `tenant_id`. Node returns only an
opaque `handoffCode`; the browser completes it with
`GET /admin/auth/handoff?code=...&mode=fetch`.

Socket.IO also permits credentials only from `CLIENT_ORIGIN`; room
authorization still derives the tenant from the signed Node session. Keep
local services on the same hostname, preferably `localhost` for both Laravel
(`http://localhost:8000`) and Live Feed (`http://localhost:3001`). Do not mix
`127.0.0.1` with `localhost` for this cookie flow. The handoff is a one-time
session bootstrap, not a browser-visible bearer-token flow.

## Related repositories

- [Laravel React Auction Web](https://github.com/pancakebaker/laravel-react-auction-web) is the tenant-facing BFF and browser client.
- [Bidding Service](https://github.com/pancakebaker/dotnet-bidding-service) owns authoritative auction state and internal room-admission decisions.
- [Operations Portal](https://github.com/pancakebaker/dotnet-blazor-operations-portal) consumes its own operations projection.
- [DBAP Platform Infrastructure](https://github.com/pancakebaker/docker-dbap-platform) provides development RabbitMQ and Redis.
- [Historical integrated monorepo](https://github.com/pancakebaker/distributed-bidding-auction-platform) preserves the original platform snapshot.

The [platform architecture map](https://github.com/pancakebaker/docker-dbap-platform/blob/main/docs/architecture.md)
shows the cross-service boundaries. This repository is a functioning service
extraction and is not a claim of complete production hardening. No license file
is currently included in this extracted repository.

## External dependencies

RabbitMQ, Redis, and the Bidding Service admission endpoint remain external runtime dependencies.
The Laravel/React client remains a separate repository and platform-level Docker orchestration is
also external. No credentials are included in this repository.
