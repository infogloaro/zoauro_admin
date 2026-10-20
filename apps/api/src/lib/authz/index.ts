export type { AuthContext, ZoneLimits, ZoneScope } from './types';
export { can, zonesFor, scopeKey, assertCanRead, assertCanWrite, holdsAnywhere } from './can';
export { resolveAccess, EMPTY_ACCESS, isOverrideAction } from './resolver';
export type {
  AccessAssignment,
  ProfilePermissionRow,
  ResolvedAccess,
  OverrideAction,
} from './resolver';
export { AccessService, MAX_ACCESS_CACHE_TTL_SEC } from './access-service';
export type { AccessDataSource, RefundCapsReader } from './access-service';
export {
  authContextMiddleware,
  authContextOf,
  getAuthContext,
  requirePermission,
} from './middleware';
export type { PermissionGuard } from './middleware';
export { BaseRepository } from './base-repository';
export type { ScopedDelegate } from './base-repository';
