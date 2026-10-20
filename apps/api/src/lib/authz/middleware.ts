import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  isGrantable,
  permissionKey,
  type PermissionAction,
  type PermissionKey,
  type PermissionModule,
} from '@zoauro/shared';
import { getAuth, requireSession } from '../auth/middleware';
import { AppError } from '../errors';
import type { AccessService } from './access-service';
import { holdsAnywhere } from './can';
import type { AuthContext } from './types';

const zoneIdsSchema = z.array(z.uuid()).max(50);

/** `?zoneId=` (repeatable, doc 09). A malformed id is a validation error, not a silent empty result. */
function parseRequestedZones(raw: unknown): string[] | 'ALL' {
  if (raw === undefined) return 'ALL';
  const list = Array.isArray(raw) ? raw : [raw];
  const parsed = zoneIdsSchema.safeParse(list);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid input', [
      { field: 'zoneId', issue: 'invalid_zone_id' },
    ]);
  }
  return [...new Set(parsed.data)];
}

/**
 * Builds the AuthContext on every request that has a session (install right after the session middleware).
 * It is kept in res.locals for this request only; it is never written to the session.
 */
export function authContextMiddleware(access: AccessService): RequestHandler {
  return async (req, res, next) => {
    const auth = getAuth(res);
    if (auth) {
      res.locals['authContext'] = await access.buildContext(
        { userId: auth.userId, role: auth.role },
        parseRequestedZones(req.query['zoneId']),
      );
    }
    next();
  };
}

export function getAuthContext(res: Response): AuthContext | undefined {
  const ctx: unknown = res.locals['authContext'];
  return typeof ctx === 'object' && ctx !== null ? (ctx as AuthContext) : undefined;
}

/** For handlers behind requirePermission: the context is guaranteed to exist. */
export function authContextOf(res: Response): AuthContext {
  const ctx = getAuthContext(res);
  if (!ctx) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return ctx;
}

export type PermissionGuard = RequestHandler & { requiredPermission: PermissionKey };

/**
 * Route guard: every route declares `module:action` (doc 09). It is deliberately coarse; the zone is checked where the
 * object is known (services: assertCanRead / assertCanWrite) and in the repository (zonesFor).
 *  - no session -> 401; first-login password change pending -> 403
 *  - Zonal Admin and an action that can never be granted for this module (zones, access, settings, ...) -> 403
 *  - write actions need the permission in at least one zone -> 403 otherwise, unless the request names a zone
 *    (`zoneInRequest`): then assertCanWrite decides (404 for an unassigned zone, 403 for a missing action)
 *  - view actions pass: with no viewable zone the repository returns an empty result (TC-MZ-13)
 */
export function requirePermission(
  module: PermissionModule,
  action: PermissionAction,
  opts: { zoneInRequest?: boolean } = {},
): PermissionGuard {
  const key = permissionKey(module, action);
  const needSession = requireSession();
  const guard: RequestHandler = (req, res, next) => {
    needSession(req, res, () => {
      const ctx = authContextOf(res);
      if (ctx.isSuperAdmin) {
        next();
        return;
      }
      if (!isGrantable(module, action))
        throw new AppError('FORBIDDEN', 'You do not have permission to do this');
      // A route that names a zone (path or body) leaves 404-versus-403 to assertCanWrite: an unassigned zone is 404 for
      // everyone, including a member who holds the action nowhere (doc 24 section 2: Admin(none) = 404).
      if (action !== 'view' && !opts.zoneInRequest && !holdsAnywhere(ctx, key)) {
        throw new AppError('FORBIDDEN', 'You do not have permission to do this');
      }
      next();
    });
  };
  return Object.assign(guard, { requiredPermission: key });
}
