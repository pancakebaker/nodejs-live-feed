/**
 * Socket.IO adapter for safe operational activity updates to authorized admin sockets.
 */
import type { Server } from 'socket.io';
import type { OperationalActivity } from '../../application/diagnostics/recent-activity-store.js';
import type { LiveFeedHistoryRecord } from '../../application/history/live-feed-history-types.js';
import type { LiveFeedHistoryStore } from '../../application/ports/live-feed-history-store.js';
import type { ActivityRecorder } from '../../application/ports/activity-recorder.js';
import type { AdminActivityPublisher, AdminActivityUpdate } from '../../application/ports/admin-activity-publisher.js';
import { adminSocketEvents, adminSocketRooms, adminTenantActivityRoom } from '../../domain/transport.js';

/** Socket.IO room reserved for authorized operational admin sockets. */
export const adminLiveFeedRoom = adminSocketRooms.liveFeed;
/** Socket.IO event carrying safe operational activity metadata. */
export const adminActivityEvent = adminSocketEvents.activity;
/** Socket.IO event carrying normalized chart activity deltas. */
export const adminActivityDeltaEvent = adminSocketEvents.activityDelta;

/**
 * Publishes operational activity only to the separate admin room.
 */
export class SocketIoAdminLiveFeedPublisher {
  public constructor(private readonly io: Server) {}

  /**
   * Emits safe activity metadata without changing normal auction rooms or events.
   */
  public publish(activity: OperationalActivity): void {
    this.io.to(adminLiveFeedRoom).emit(adminActivityEvent, { ...activity });
  }
}

/** Publishes chart-safe deltas to the tenant room and global admin room. */
export class SocketIoAdminActivityPublisher implements AdminActivityPublisher {
  public constructor(private readonly io: Server) {}

  /** Emits a delta to its tenant room and the existing global admin room. */
  public publish(update: AdminActivityUpdate): void {
    const payload = { ...update };
    this.io.to(adminTenantActivityRoom(update.tenantId)).emit(adminActivityDeltaEvent, payload);
    this.io.to(adminLiveFeedRoom).emit(adminActivityDeltaEvent, payload);
  }
}

/**
 * Combines the bounded activity store and admin Socket.IO publisher.
 */
export class LiveFeedActivityObserver implements ActivityRecorder {
  public constructor(
    private readonly store: ActivityRecorder,
    private readonly publisher: SocketIoAdminLiveFeedPublisher,
    private readonly historyStore?: LiveFeedHistoryStore,
  ) {}

  /**
   * Records and publishes best-effort activity without affecting event processing.
   */
  public record(activity: OperationalActivity): void {
    try {
      this.store.record(activity);
      this.publisher.publish(activity);
      const historyRecord: LiveFeedHistoryRecord = {
        tenantId: activity.tenantId,
        eventId: activity.eventId,
        auctionId: activity.auctionId,
        eventType: activity.eventType,
        aggregateVersion: activity.aggregateVersion,
        correlationId: activity.correlationId,
        processedAt: activity.receivedAt,
        outcome: activity.outcome,
      };
      void Promise.resolve(this.historyStore?.record(historyRecord)).catch((error: unknown) => {
        console.warn('Live-feed history persistence failed.', {
          message: error instanceof Error ? error.message : 'unknown_error',
        });
      });
    } catch (error) {
      console.warn('Live-feed operational activity observation failed.', {
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }
}
