import type { Role } from '@zoauro/shared';

/**
 * Authenticated request context (doc 14 §4). Zone assignments and permissions
 * are resolved per request in SA-1.7; for SA-1.1 zones are Super Admin only.
 */
export interface AuthContext {
  userId: string;
  role: Role;
  isSuperAdmin: boolean;
  sessionId: string;
  reauthenticatedAt: Date | null;
  ip: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

export function clientIp(
  headers: Record<string, unknown>,
  socketAddress?: string | null,
): string | null {
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return socketAddress ?? null;
}
