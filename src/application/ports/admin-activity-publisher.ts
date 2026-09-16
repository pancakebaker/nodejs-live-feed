/** Application port for normalized tenant-wide admin activity deltas. */
import type {
  AuctionPurchasedSocketPayload,
  BidAcceptedSocketPayload,
} from '../../domain/events.js';

/** Event types currently relevant to live activity reporting. */
export type AdminActivityEventType = 'BidAccepted' | 'AuctionPurchased';

/** Normalized event data required by the admin activity dashboard. */
export type AdminActivityUpdate = {
  eventId: string;
  eventType: AdminActivityEventType;
  tenantId: string;
  auctionId: string;
  occurredAtUtc: string;
  aggregateVersion: number;
  payload: BidAcceptedSocketPayload | AuctionPurchasedSocketPayload;
};

/** Publishes accepted activity deltas to authorized admin transport rooms. */
export interface AdminActivityPublisher {
  publish(update: AdminActivityUpdate): void;
}
