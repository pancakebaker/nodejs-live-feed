import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminAuth } from '../../src/transport/http/admin/admin-auth.js';
import { registerAdminActivitySubscriptionHandlers } from '../../src/transport/websocket/admin-activity-subscription-handler.js';
import { adminSocketEvents, adminTenantActivityRoom } from '../../src/domain/transport.js';
import { adminLiveFeedRoom } from '../../src/transport/websocket/admin-live-feed-publisher.js';

const tenantA = 'aaaaaaaa-1111-4111-8111-111111111111';
const tenantB = 'bbbbbbbb-2222-4222-8222-222222222222';

function socket(cookie?: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const joined: string[] = [];
  const left: string[] = [];
  return {
    handshake: { headers: { cookie } },
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    join: (room: string) => {
      joined.push(room);
      return Promise.resolve();
    },
    leave: (room: string) => {
      left.push(room);
      return Promise.resolve();
    },
    handlers,
    joined,
    left,
  };
}

void test('tenant-scoped admin subscription derives its room from signed claims', async () => {
  const auth = new AdminAuth({ secret: 'test-secret', secure: false, now: () => 1_000_000 });
  const client = socket(
    auth.createSession({
      sub: 'admin',
      role: 'SystemAdministrator',
      permissions: ['livefeed.admin'],
      tenantId: tenantA,
    }),
  );
  registerAdminActivitySubscriptionHandlers(client as never, auth);
  let response: unknown;

  client.handlers.get(adminSocketEvents.activitySubscribe)?.(
    { tenantId: tenantB },
    (value: unknown) => {
      response = value;
    },
  );
  await Promise.resolve();

  assert.deepEqual(client.joined, [adminTenantActivityRoom(tenantA)]);
  assert.deepEqual(response, { ok: true, room: adminTenantActivityRoom(tenantA) });
});

void test('legacy global system-admin sessions retain global activity visibility', async () => {
  const auth = new AdminAuth({ secret: 'test-secret', secure: false, now: () => 1_000_000 });
  const client = socket(auth.createSession());
  registerAdminActivitySubscriptionHandlers(client as never, auth);
  let response: unknown;

  client.handlers.get(adminSocketEvents.activitySubscribe)?.({}, (value: unknown) => {
    response = value;
  });
  await Promise.resolve();

  assert.deepEqual(client.joined, [adminLiveFeedRoom]);
  assert.deepEqual(response, { ok: true, room: adminLiveFeedRoom });
});

void test('unauthorized sockets cannot join tenant activity rooms', () => {
  const auth = new AdminAuth({ secret: 'test-secret', secure: false, now: () => 1_000_000 });
  const client = socket();
  registerAdminActivitySubscriptionHandlers(client as never, auth);
  let response: unknown;

  client.handlers.get(adminSocketEvents.activitySubscribe)?.({}, (value: unknown) => {
    response = value;
  });

  assert.deepEqual(client.joined, []);
  assert.deepEqual(response, { ok: false, error: 'admin_authorization_required' });
});
