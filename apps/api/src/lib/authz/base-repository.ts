import type { PermissionKey } from '@zoauro/shared';
import { zonesFor } from './can';
import type { AuthContext } from './types';

// Base class for every zone-owned repository (AGENTS.md: "Non-Super-Admin queries ALWAYS filter by zone_id IN ...").
// It never imports Prisma: a concrete repository.ts passes its model delegate and says how to express "zone in" and "id".
// Reads go through the protected *Scoped methods, which cannot be called without an AuthContext. A repository that
// bypasses them is caught by the scope harness (tests/authz).

export interface ScopedDelegate<W, R> {
  findMany(args: { where: W; skip?: number; take?: number }): Promise<R[]>;
  findFirst(args: { where: W }): Promise<R | null>;
  count(args: { where: W }): Promise<number>;
}

export abstract class BaseRepository<W extends object, R> {
  protected constructor(
    protected readonly delegate: ScopedDelegate<W, R>,
    /** the permission whose zones bound every read of this repository, e.g. 'orders:view' */
    protected readonly viewPermission: PermissionKey,
  ) {}

  /** `{ zoneId: { in: zoneIds } }` in the model's own terms. */
  protected abstract zoneFilter(zoneIds: readonly string[]): W;
  protected abstract idFilter(id: string): W;

  /**
   * The caller's filter ANDed with the zone filter for `key`. null = the actor may touch no zone at all
   * (the query must not run). Super Admin with no zone requested gets the caller's filter unchanged.
   */
  protected scope(ctx: AuthContext, key: PermissionKey, where?: W): W | null {
    const scope = zonesFor(ctx, key);
    if (scope.kind === 'ALL') return where ?? ({} as W);
    if (scope.zoneIds.length === 0) return null;
    const zone = this.zoneFilter(scope.zoneIds);
    return where ? ({ AND: [where, zone] } as unknown as W) : zone;
  }

  protected async findScoped(
    ctx: AuthContext,
    opts: { where?: W; skip?: number; take?: number } = {},
  ): Promise<R[]> {
    const where = this.scope(ctx, this.viewPermission, opts.where);
    if (where === null) return [];
    return this.delegate.findMany({
      where,
      ...(opts.skip === undefined ? {} : { skip: opts.skip }),
      ...(opts.take === undefined ? {} : { take: opts.take }),
    });
  }

  /** null for a missing row AND for a row in a zone the actor cannot see: the caller answers 404 either way. */
  protected async findOneScoped(ctx: AuthContext, id: string): Promise<R | null> {
    const where = this.scope(ctx, this.viewPermission, this.idFilter(id));
    if (where === null) return null;
    return this.delegate.findFirst({ where });
  }

  protected async countScoped(ctx: AuthContext, where?: W): Promise<number> {
    const scoped = this.scope(ctx, this.viewPermission, where);
    if (scoped === null) return 0;
    return this.delegate.count({ where: scoped });
  }
}
