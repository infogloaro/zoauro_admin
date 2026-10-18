import type { Server as HttpServer } from 'node:http';
import type { PermissionModule } from '@zoauro/shared';
import { Server, type Socket } from 'socket.io';
import type { AuthContext } from '../authz';
import { allZonesRoom, userRoom, zoneRoom, type RealtimeMessage } from './events';

// Socket.IO for the admin panel (doc 06 section 6, doc 14 section 4, doc 36 section 5; TC-MZ-11):
//  - the handshake uses the session cookie; no session, or a first-login password change pending, is refused;
//  - the server joins rooms, the client never can: `zone:<id>:<module>` for every zone where the member holds
//    <module>:view (Super Admin: `all:<module>`), plus `user:<id>`;
//  - a zone message goes to that zone's module room and the all-zones room only, so a member never receives an event
//    for a zone or module it cannot view;
//  - scope.changed: the member's sockets drop every scoped room, re-join from the access tables and get the event,
//    so the client refetches /me (doc 14, doc 23).

/** Modules with zone rooms (doc 14 section 4). */
export const REALTIME_MODULES: readonly PermissionModule[] = ['orders', 'refunds'];

export interface RealtimeCaller {
  userId: string;
  role: AuthContext['role'];
  mustChangePassword: boolean;
}

export interface RealtimeDeps {
  appOrigin: string;
  /** the session behind the Cookie header of the handshake, or null */
  authenticate(cookieHeader: string | undefined): Promise<RealtimeCaller | null>;
  /** the member's AuthContext for all zones (AccessService.buildContext with 'ALL') */
  contextOf(caller: RealtimeCaller): Promise<AuthContext>;
  log?: (line: string) => void;
}

/** The scoped rooms of one member (user room excluded). */
export function roomsFor(ctx: AuthContext): string[] {
  if (ctx.isSuperAdmin) return REALTIME_MODULES.map(allZonesRoom);
  const rooms: string[] = [];
  for (const zoneId of ctx.assignedZoneIds) {
    const keys = ctx.permissionsByZone.get(zoneId);
    for (const m of REALTIME_MODULES) if (keys?.has(`${m}:view`)) rooms.push(zoneRoom(zoneId, m));
  }
  return rooms;
}

const isScopedRoom = (room: string) => room.startsWith('zone:') || room.startsWith('all:');

export interface RealtimeServer {
  io: Server;
  deliver(messages: readonly RealtimeMessage[]): Promise<void>;
  close(): Promise<void>;
}

export function attachRealtime(httpServer: HttpServer, deps: RealtimeDeps): RealtimeServer {
  const log = deps.log ?? ((l: string) => console.error(l));
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: deps.appOrigin, credentials: true },
    // cookies make a cross-site socket possible: only our own origin may open one (as originCheck for writes)
    allowRequest: (req, cb) => cb(null, req.headers.origin === deps.appOrigin),
  });

  async function join(socket: Socket, caller: RealtimeCaller): Promise<string[]> {
    const rooms = roomsFor(await deps.contextOf(caller));
    for (const r of [...socket.rooms]) if (isScopedRoom(r)) socket.leave(r);
    socket.join([userRoom(caller.userId), ...rooms]);
    return rooms;
  }

  io.use((socket, next) => {
    void (async () => {
      const caller = await deps.authenticate(socket.request.headers.cookie);
      if (!caller) return next(new Error('UNAUTHENTICATED'));
      if (caller.mustChangePassword) return next(new Error('PASSWORD_CHANGE_REQUIRED'));
      socket.data['caller'] = caller;
      next();
    })().catch((err: unknown) => {
      log(`[realtime] handshake failed (${err instanceof Error ? err.name : 'unknown'})`);
      next(new Error('UNAVAILABLE'));
    });
  });

  io.on('connection', (socket) => {
    const caller = socket.data['caller'] as RealtimeCaller;
    join(socket, caller).catch(() => socket.disconnect(true));
  });

  async function rescope(userId: string) {
    for (const s of await io.in(userRoom(userId)).fetchSockets()) {
      const socket = io.sockets.sockets.get(s.id);
      const caller = socket?.data['caller'] as RealtimeCaller | undefined;
      if (!socket || !caller) continue;
      try {
        await join(socket, caller);
        socket.emit('scope.changed', {});
      } catch {
        socket.disconnect(true); // context unreadable: the client reconnects and is checked afresh
      }
    }
  }

  return {
    io,
    async deliver(messages) {
      for (const m of messages) {
        if (m.kind === 'scope') await rescope(m.userId);
        else io.to([zoneRoom(m.zoneId, m.module), allZonesRoom(m.module)]).emit(m.event, m.payload);
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        void io.close(() => resolve());
      }),
  };
}
