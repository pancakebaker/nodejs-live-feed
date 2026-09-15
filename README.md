# Node.js Live Feed

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

## Event compatibility

`contracts/fixtures/v1` contains copied golden compatibility baselines originating from the DBAP
integration contracts for `BidAccepted`, `AuctionClosed`, and `WinnerSelected`. The contract tests
load these files locally, so validation never depends on the source monorepo. `v1` is the current
wire baseline; breaking changes require a new fixture version rather than silently editing v1.
Independent npm packaging and version distribution are intentionally deferred until repository
boundaries are established.

## Local setup

1. Install Node.js 24.x and copy `.env.example` to `.env`.
2. Provide the external RabbitMQ and Redis services, and configure Bidding Service access when
   exercising authenticated subscriptions.
3. Install and validate:

```text
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

Run `npm run dev` for the service and `npm run watch:auction -- <auction-id>` for the development
Socket.IO observer. `npm run migrate:history` applies the optional history migration when
`LIVE_FEED_DATABASE_URL` is configured.

## External dependencies

RabbitMQ, Redis, and the Bidding Service admission endpoint remain external runtime dependencies.
The Laravel/React client remains a separate repository and platform-level Docker orchestration is
also external. No credentials are included in this repository.
