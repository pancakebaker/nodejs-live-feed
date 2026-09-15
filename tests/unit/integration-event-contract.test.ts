import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  aggregateTypes,
  integrationEventTypes,
  validateLiveFeedEnvelope,
} from '../../src/domain/events.js';
import {
  adminSocketEvents,
  adminSocketRooms,
  auctionSocketEvents,
  integrationEventRoutingKeys,
} from '../../src/domain/transport.js';

const tenantId = 'aaaaaaaa-1111-4111-8111-111111111111';

const fixtureDirectory = fileURLToPath(
  new URL('../../tests/contracts/fixtures/v1/', import.meta.url),
);

const fixtureNames = [
  'auction-bid-accepted.json',
  'auction-closed.json',
  'winner-selected.json',
] as const;

void test('integration event wire values remain stable', () => {
  assert.deepEqual(integrationEventTypes, {
    bidAccepted: 'BidAccepted',
    auctionClosed: 'AuctionClosed',
    winnerSelected: 'WinnerSelected',
    auctionPurchased: 'AuctionPurchased',
    auctionCancelled: 'AuctionCancelled',
    tenantStatusChanged: 'TenantStatusChanged',
  });
  assert.equal(aggregateTypes.auction, 'Auction');
  assert.equal(aggregateTypes.tenant, 'Tenant');
  assert.deepEqual(integrationEventRoutingKeys, {
    bidAccepted: 'auction.bid.accepted',
    auctionClosed: 'auction.closed',
    winnerSelected: 'auction.winner.selected',
    auctionPurchased: 'auction.purchased',
    auctionCancelled: 'auction.cancelled',
    tenantStatusChanged: 'tenant.status.changed',
  });
});

void test('Socket.IO transport wire values remain stable', () => {
  assert.deepEqual(auctionSocketEvents, {
    bidAccepted: 'bid:accepted',
    auctionClosed: 'auction:closed',
    winnerSelected: 'winner:selected',
    auctionPurchased: 'auction:purchased',
    auctionCancelled: 'auction:cancelled',
    subscribe: 'auction:subscribe',
    unsubscribe: 'auction:unsubscribe',
  });
  assert.deepEqual(adminSocketEvents, {
    subscribe: 'admin:subscribe',
    activity: 'admin:activity',
    subscriptionError: 'subscription:error',
  });
  assert.equal(adminSocketRooms.liveFeed, 'admin:live-feed');
});

function purchaseEnvelope(overrides: Record<string, unknown> = {}) {
  const auctionId = '11111111-1111-1111-1111-111111111111';
  return {
    eventId: '22222222-2222-2222-2222-222222222222',
    eventType: 'AuctionPurchased',
    occurredAtUtc: '2026-01-01T00:00:00.000Z',
    aggregateType: 'Auction',
    aggregateId: auctionId,
    aggregateVersion: 12,
    correlationId: 'correlation-12',
    payload: {
      tenantId,
      auctionId,
      bidderId: 'buyer-123',
      finalPrice: 1000,
      purchasedAtUtc: '2026-01-01T00:00:00.000Z',
      auctionVersion: 12,
    },
    ...overrides,
  };
}

void test('valid AuctionPurchased envelopes preserve the producer contract', () => {
  const envelope = validateLiveFeedEnvelope(purchaseEnvelope());

  assert.equal(envelope.eventType, 'AuctionPurchased');
  assert.equal(envelope.aggregateVersion, 12);
  assert.equal(envelope.payload.bidderId, 'buyer-123');
  assert.equal(envelope.payload.finalPrice, 1000);
});

void test('malformed AuctionPurchased payloads are rejected', () => {
  assert.throws(() => validateLiveFeedEnvelope(purchaseEnvelope({ payload: {} })), /auctionId/);
  assert.throws(
    () =>
      validateLiveFeedEnvelope(
        purchaseEnvelope({
          payload: { ...(purchaseEnvelope().payload as object), finalPrice: '1000' },
        }),
      ),
    /finalPrice/,
  );
  assert.throws(
    () =>
      validateLiveFeedEnvelope(
        purchaseEnvelope({
          payload: { ...(purchaseEnvelope().payload as object), auctionVersion: 11 },
        }),
      ),
    /auctionVersion/,
  );
});

void test('unknown event types remain rejected', () => {
  assert.throws(
    () => validateLiveFeedEnvelope(purchaseEnvelope({ eventType: 'UnknownEvent' })),
    /Unsupported eventType/,
  );
});

void test('valid and malformed AuctionCancelled envelopes follow the contract', () => {
  const auctionId = '11111111-1111-1111-1111-111111111111';
  const envelope = validateLiveFeedEnvelope({
    eventId: '33333333-3333-3333-3333-333333333333',
    eventType: 'AuctionCancelled',
    occurredAtUtc: '2026-01-01T00:00:00.000Z',
    aggregateType: 'Auction',
    aggregateId: auctionId,
    aggregateVersion: 13,
    correlationId: 'cancel-correlation',
    payload: { tenantId, auctionId },
  });

  assert.equal(envelope.eventType, 'AuctionCancelled');
  assert.equal(envelope.payload.auctionId, auctionId);
  assert.throws(
    () => validateLiveFeedEnvelope({ ...envelope, payload: { tenantId, auctionId: 'invalid' } }),
    /AuctionCancelled payload/,
  );
});

void test('v1 golden fixtures preserve the live-feed contract', async () => {
  for (const fixtureName of fixtureNames) {
    const fixture = JSON.parse(
      await readFile(`${fixtureDirectory}${fixtureName}`, 'utf8'),
    ) as Record<string, unknown>;
    const envelope = validateLiveFeedEnvelope(fixture);

    assert.equal(envelope.aggregateId, envelope.payload.auctionId);
    assert.ok('auctionVersion' in envelope.payload);
    assert.equal(envelope.aggregateVersion, envelope.payload.auctionVersion);
    assert.equal(envelope.payload.tenantId, tenantId);

    const missingRequiredField = structuredClone(fixture);
    delete (missingRequiredField.payload as Record<string, unknown>).auctionId;
    assert.throws(() => validateLiveFeedEnvelope(missingRequiredField), /auctionId/);
  }
});

void test('TenantStatusChanged envelopes preserve tenant version and status contract', () => {
  const envelope = validateLiveFeedEnvelope({
    eventId: '44444444-4444-4444-4444-444444444444',
    eventType: 'TenantStatusChanged',
    occurredAtUtc: '2026-01-01T00:00:00.000Z',
    aggregateType: 'Tenant',
    aggregateId: tenantId,
    aggregateVersion: 4,
    correlationId: 'tenant-status-correlation',
    payload: {
      eventId: '44444444-4444-4444-4444-444444444444',
      tenantId,
      previousStatus: 'Active',
      currentStatus: 'Disabled',
      tenantVersion: 4,
      occurredAtUtc: '2026-01-01T00:00:00.000Z',
    },
  });

  assert.equal(envelope.eventType, 'TenantStatusChanged');
  assert.equal(envelope.aggregateVersion, 4);
  assert.equal(envelope.payload.currentStatus, 'Disabled');
  assert.throws(
    () => validateLiveFeedEnvelope({ ...envelope, aggregateVersion: 3 }),
    /tenantVersion/,
  );
});
