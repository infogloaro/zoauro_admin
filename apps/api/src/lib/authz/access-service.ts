import type { Redis } from 'ioredis';
import type { PermissionKey, Role } from '@zoauro/shared';
import { AppError } from '../errors';
import { resolveAccess, type AccessAssignment, type ResolvedAccess } from './resolver';
import type { AuthContext, ZoneLimits } from './types';

/** Implemented by the access repository (the only place that reads the access tables through Prisma). */
export interface AccessDataSource {
  /** active (not revoked) assignments of the user, with profile, profile permissions and overrides */
  loadAssignments(userId: string): Promise<AccessAssignment[]>;
  /** members currently assigned with this profile (for invalidation after a profile edit) */
  findUserIdsByProfile(profileId: string): Promise<string[]>;
  /** members currently assigned to this zone (for invalidation after a team change) */
  findUserIdsByZone(zoneId: string): Promise<string[]>;
}

/** D110: per zone, the most any Zonal Admin may refund at once and per day (settings refunds.limits), in paise. */
export type RefundCapsReader = (
  zoneIds: readonly string[],
) => Promise<ReadonlyMap<string, { perRefundPaise: number; perDayPaise: number }>>;

/** Doc 14 section 4: cache TTL is at most 60 seconds. */
export const MAX_ACCESS_CACHE_TTL_SEC = 60;
const CACHE_VERSION = 1;

interface CacheEntry {
  v: number;
  access: ResolvedAccess;
}

export class AccessService {
  private readonly ttlSec: number;

  constructor(
    private readonly deps: {
      source: AccessDataSource;
      redis: Redis;
      /** clamped to 1..60 */
      cacheTtlSec?: number;
      /** D110: a member's effective refund limits never exceed the zone caps (absent: no caps, tests) */
      refundCaps?: RefundCapsReader;
    },
  ) {
    this.ttlSec = Math.min(
      MAX_ACCESS_CACHE_TTL_SEC,
      Math.max(1, Math.floor(deps.cacheTtlSec ?? MAX_ACCESS_CACHE_TTL_SEC)),
    );
  }

  private key = (userId: string): string => `authctx:${userId}`;

  /** Resolved access for a Zonal Admin: Redis read-through, falling back to PostgreSQL if Redis is unavailable. */
  async resolve(userId: string): Promise<ResolvedAccess> {
    const cached = await this.readCache(userId);
    if (cached) return cached;
    const access = resolveAccess(await this.deps.source.loadAssignments(userId));
    await this.writeCache(userId, access);
    return access;
  }

  /**
   * Builds the AuthContext for one request. Nothing about zones or permissions comes from the session: `role` and
   * `userId` identify the caller, everything else is resolved from the access tables (or their <= 60 s cache).
   * A requested zone the Zonal Admin is not assigned to is 404 ZONE_NOT_FOUND.
   */
  async buildContext(
    caller: { userId: string; role: Role },
    requestedZoneIds: readonly string[] | 'ALL',
  ): Promise<AuthContext> {
    if (caller.role === 'SUPER_ADMIN') {
      return {
        userId: caller.userId,
        role: caller.role,
        isSuperAdmin: true,
        assignedZoneIds: [],
        permissionsByZone: new Map(),
        limitsByZone: new Map(),
        requestedZoneIds,
      };
    }

    const access = await this.resolve(caller.userId);
    if (
      requestedZoneIds !== 'ALL' &&
      requestedZoneIds.some((z) => !access.assignedZoneIds.includes(z))
    ) {
      throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
    }
    return {
      userId: caller.userId,
      role: caller.role,
      isSuperAdmin: false,
      assignedZoneIds: access.assignedZoneIds,
      permissionsByZone: new Map(
        Object.entries(access.permissions).map(
          ([zone, keys]): [string, ReadonlySet<PermissionKey>] => [zone, new Set(keys)],
        ),
      ),
      limitsByZone: await this.capped(access),
      requestedZoneIds,
    };
  }

  /** D110: the member's own limits, never above the zone caps; unreadable caps fail closed (no refund allowance). */
  private async capped(access: ResolvedAccess): Promise<Map<string, ZoneLimits>> {
    const limits = new Map(Object.entries(access.limits));
    if (!this.deps.refundCaps || limits.size === 0) return limits;
    let caps: ReadonlyMap<string, { perRefundPaise: number; perDayPaise: number }> | null = null;
    try {
      caps = await this.deps.refundCaps([...limits.keys()]);
    } catch {
      caps = null;
    }
    for (const [zone, l] of limits) {
      const cap = caps?.get(zone);
      limits.set(zone, {
        ...l,
        perRefund: cap ? Math.min(l.perRefund, cap.perRefundPaise) : 0,
        dailyRefund: cap ? Math.min(l.dailyRefund, cap.perDayPaise) : 0,
      });
    }
    return limits;
  }

  // ---- explicit invalidation (called by the Access Control module after every access change) ---------------------

  async invalidateUsers(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.deps.redis.del(...userIds.map(this.key)).catch(() => undefined);
  }

  async invalidateProfile(profileId: string): Promise<void> {
    await this.invalidateUsers(await this.deps.source.findUserIdsByProfile(profileId));
  }

  async invalidateZone(zoneId: string): Promise<void> {
    await this.invalidateUsers(await this.deps.source.findUserIdsByZone(zoneId));
  }

  // ---- cache -----------------------------------------------------------------------------------------------------

  private async readCache(userId: string): Promise<ResolvedAccess | null> {
    try {
      const raw = await this.deps.redis.get(this.key(userId));
      if (!raw) return null;
      const entry = JSON.parse(raw) as Partial<CacheEntry>;
      return entry.v === CACHE_VERSION && entry.access ? entry.access : null;
    } catch {
      return null; // unreadable or Redis down: recompute from PostgreSQL
    }
  }

  private async writeCache(userId: string, access: ResolvedAccess): Promise<void> {
    try {
      const entry: CacheEntry = { v: CACHE_VERSION, access };
      await this.deps.redis.set(this.key(userId), JSON.stringify(entry), 'EX', this.ttlSec);
    } catch {
      /* cache only */
    }
  }
}
