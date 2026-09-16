/** Socket.IO admission handlers for tenant-wide admin activity deltas. */
import type { Socket } from 'socket.io';
import type { AdminAuth } from '../http/admin/admin-auth.js';
import { adminSocketEvents, adminTenantActivityRoom } from '../../domain/transport.js';
import { adminLiveFeedRoom } from './admin-live-feed-publisher.js';

type Acknowledge = (response: { ok: boolean; room?: string; error?: string }) => void;

/** Joins only the server-derived tenant room, or the existing global admin room. */
export function registerAdminActivitySubscriptionHandlers(socket: Socket, auth: AdminAuth): void {
  socket.on(adminSocketEvents.activitySubscribe, (value: unknown, acknowledge?: Acknowledge) => {
    const room = resolveRoom(socket, auth);
    if (!room) {
      acknowledge?.({ ok: false, error: 'admin_authorization_required' });
      return;
    }

    void socket.join(room);
    acknowledge?.({ ok: true, room });
    void value;
  });

  socket.on(adminSocketEvents.activityUnsubscribe, (_value: unknown, acknowledge?: Acknowledge) => {
    const room = resolveRoom(socket, auth);
    if (!room) {
      acknowledge?.({ ok: false, error: 'admin_authorization_required' });
      return;
    }

    void socket.leave(room);
    acknowledge?.({ ok: true, room });
  });
}

function resolveRoom(socket: Socket, auth: AdminAuth): string | undefined {
  if (!auth.isAuthorizedCookie(socket.handshake.headers.cookie)) return undefined;
  const claims = auth.sessionClaims(socket.handshake.headers.cookie);
  return claims?.tenantId ? adminTenantActivityRoom(claims.tenantId) : adminLiveFeedRoom;
}
