/**
 * Tests the isolated admin Socket.IO operational activity publisher.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminActivityDeltaEvent,
  adminActivityEvent,
  adminLiveFeedRoom,
  SocketIoAdminActivityPublisher,
  SocketIoAdminLiveFeedPublisher,
} from '../../src/transport/websocket/admin-live-feed-publisher.js';
import { adminTenantActivityRoom } from '../../src/domain/transport.js';

void test('admin publisher emits safe activity only to the admin room', () => {
  const calls: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => calls.push({ room, event, payload }),
    }),
  };
  const publisher = new SocketIoAdminLiveFeedPublisher(io as never);
  const activity = {
    eventId: 'event-id',
    eventType: 'BidAccepted',
    auctionId: 'auction-id',
    aggregateVersion: 2,
    correlationId: 'correlation-id',
    receivedAt: new Date().toISOString(),
    outcome: 'applied' as const,
  };

  publisher.publish(activity);

  assert.deepEqual(calls, [
    { room: adminLiveFeedRoom, event: adminActivityEvent, payload: activity },
  ]);
  assert.notEqual(calls[0]?.payload, activity);
});

void test('admin activity publisher fans out normalized deltas to the tenant and global rooms', () => {
  const calls: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => calls.push({ room, event, payload }),
    }),
  };
  const update = {
    eventId: 'event-id',
    eventType: 'AuctionPurchased' as const,
    tenantId: 'tenant-id',
    auctionId: 'auction-id',
    occurredAtUtc: '2026-09-16T10:00:00.000Z',
    aggregateVersion: 12,
    payload: {
      tenantId: 'tenant-id',
      auctionId: 'auction-id',
      bidderId: 'opaque-bidder-id',
      finalPrice: 500,
      auctionVersion: 12,
      purchasedAtUtc: '2026-09-16T10:00:00.000Z',
      occurredAtUtc: '2026-09-16T10:00:00.000Z',
      correlationId: null,
    },
  };

  new SocketIoAdminActivityPublisher(io as never).publish(update);

  assert.deepEqual(calls, [
    { room: adminTenantActivityRoom('tenant-id'), event: adminActivityDeltaEvent, payload: update },
    { room: adminLiveFeedRoom, event: adminActivityDeltaEvent, payload: update },
  ]);
});
