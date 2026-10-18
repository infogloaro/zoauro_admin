import type { Server as HttpServer } from 'node:http';
import type { Request, RequestHandler, Response } from 'express';
import { getAuth } from '../auth/middleware';
import type { AccessService } from '../authz';
import { subscribeRealtime } from './relay';
import { attachRealtime, type RealtimeCaller, type RealtimeServer } from './socket-server';

// The API side in one call, for server.ts: the handshake resolves the session with the SAME session middleware the
// HTTP routes use (zo_sid cookie, Redis/PostgreSQL session store), rooms come from the AccessService, and messages
// published by the worker's relay are delivered to this instance's sockets.

/** Runs the Express session middleware on the handshake's Cookie header only. */
export function sessionAuthenticator(
  sessionMiddleware: RequestHandler,
): (cookieHeader: string | undefined) => Promise<RealtimeCaller | null> {
  return (cookieHeader) =>
    new Promise((resolve, reject) => {
      const req = {
        get: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : undefined),
      } as unknown as Request;
      const res = { locals: {} } as unknown as Response;
      const done = (err?: unknown) => {
        if (err) return reject(err instanceof Error ? err : new Error('session lookup failed'));
        const s = getAuth(res);
        resolve(
          s ? { userId: s.userId, role: s.role, mustChangePassword: s.mustChangePassword } : null,
        );
      };
      Promise.resolve(sessionMiddleware(req, res, done)).catch(done);
    });
}

export async function startApiRealtime(deps: {
  httpServer: HttpServer;
  appOrigin: string;
  redisUrl: string;
  sessionMiddleware: RequestHandler;
  access: Pick<AccessService, 'buildContext'>;
}): Promise<RealtimeServer> {
  const rt = attachRealtime(deps.httpServer, {
    appOrigin: deps.appOrigin,
    authenticate: sessionAuthenticator(deps.sessionMiddleware),
    contextOf: (c) => deps.access.buildContext({ userId: c.userId, role: c.role }, 'ALL'),
  });
  const sub = await subscribeRealtime(deps.redisUrl, (messages) => {
    void rt.deliver(messages).catch(() => undefined); // clients fall back to polling (doc 06)
  });
  return {
    io: rt.io,
    deliver: rt.deliver,
    close: async () => {
      await sub.close();
      await rt.close();
    },
  };
}
