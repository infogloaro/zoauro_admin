import { createHash } from 'node:crypto';
import type {
  PincodeMismatch,
  ZoneCountSource,
  ZoneCounts,
  ZoneImpact,
  ZoneImpactCounts,
  zoneTeamMemberSchema,
} from '@zoauro/shared';
import type { z } from 'zod';
import type { AuthContext } from '../../lib/authz';

// What a zone holds, counted by the modules that own the records (doc 53 section 7): Restaurants, Homemakers, Delivery
// Partners, Customers, Orders, Access, the registrations inbox, Refunds and Payouts. Those modules are built later, so
// this file defines the ports (ImpactSources) and stub implementations. A stub answers zeros and every response that
// used one says `partial: true` and names it in `missingSources`, so the UI can show "Some modules are not built yet".
// Never ship a source that reports zeros as if complete: a real implementation sets `stub: false`.

/** Every figure a source may contribute for one zone; a source fills only its own. */
export type ZoneFigures = Partial<
  Pick<ZoneCounts, 'restaurants' | 'homemakers' | 'partners' | 'customers'> &
    Omit<ZoneImpactCounts, 'members' | 'restaurants' | 'homemakers' | 'partners'>
>;

export interface ZoneCountPort {
  readonly source: ZoneCountSource;
  readonly stub: boolean;
  /** One call for any number of zones (no query per zone). Zones missing from the map count as zero. */
  countByZone(
    ctx: AuthContext,
    zoneIds: readonly string[],
  ): Promise<ReadonlyMap<string, ZoneFigures>>;
}

/** One row of GET /zones/{id}/team (the contract type; the access module supplies the rows). */
export type ZoneTeamMember = z.infer<typeof zoneTeamMemberSchema>;

/** Members of a zone: the read side of M03 (Access). */
export interface ZoneTeamPort {
  readonly stub: boolean;
  members(ctx: AuthContext, zoneId: string): Promise<ZoneTeamMember[]>;
  /** total and the first three members per zone, one call for the whole list */
  summaries(
    ctx: AuthContext,
    zoneIds: readonly string[],
  ): Promise<ReadonlyMap<string, { total: number; top: { userId: string; name: string }[] }>>;
}

/** Vendors and partners registered in the zone at one of the given pincodes (R-ZONE-8 mismatch report). */
export interface ZoneMismatchPort {
  readonly source: Extract<ZoneCountSource, 'restaurants' | 'homemakers' | 'delivery'>;
  readonly stub: boolean;
  registeredAt(
    ctx: AuthContext,
    zoneId: string,
    pincodes: readonly string[],
  ): Promise<PincodeMismatch[]>;
}

export interface ImpactSources {
  counts: ZoneCountPort[];
  team: ZoneTeamPort;
  mismatches: ZoneMismatchPort[];
}

const EMPTY = new Map<string, never>();

export const stubCountPort = (source: ZoneCountSource): ZoneCountPort => ({
  source,
  stub: true,
  countByZone: async () => EMPTY,
});
export const stubTeamPort = (): ZoneTeamPort => ({
  stub: true,
  members: async () => [],
  summaries: async () => EMPTY,
});
export const stubMismatchPort = (source: ZoneMismatchPort['source']): ZoneMismatchPort => ({
  source,
  stub: true,
  registeredAt: async () => [],
});

/** Until the modules exist: every source is a stub. */
export function stubImpactSources(): ImpactSources {
  return {
    counts: (
      [
        'restaurants',
        'homemakers',
        'delivery',
        'customers',
        'orders',
        'registrations',
        'refunds',
        'payouts',
      ] as const
    ).map(stubCountPort),
    team: stubTeamPort(),
    mismatches: (['restaurants', 'homemakers', 'delivery'] as const).map(stubMismatchPort),
  };
}

const ZERO_IMPACT: ZoneImpactCounts = {
  openOrders: 0,
  openOrdersByStatus: {},
  scheduledOrders: 0,
  restaurants: 0,
  homemakers: 0,
  partners: 0,
  partnersOnline: 0,
  members: 0,
  pendingRegistrations: 0,
  pendingRefunds: 0,
  pendingPayouts: 0,
};

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const mergeFigures = (parts: ZoneFigures[]): ZoneFigures =>
  parts.reduce<ZoneFigures>((acc, p) => ({ ...acc, ...p }), {});

/** Stable digest of the counts: the deactivate dialog sends it back, a different value means the numbers moved. */
export function impactVersionOf(counts: ZoneImpactCounts, missing: readonly string[]): string {
  const byStatus = Object.fromEntries(
    Object.entries(counts.openOrdersByStatus).sort(([a], [b]) => a.localeCompare(b)),
  );
  const stable = JSON.stringify({
    ...counts,
    openOrdersByStatus: byStatus,
    missing: [...missing].sort(),
  });
  return createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

export class ImpactService {
  constructor(private readonly sources: ImpactSources) {}

  private missing(ports: readonly { stub: boolean; source: ZoneCountSource }[]): ZoneCountSource[] {
    return unique(ports.filter((p) => p.stub).map((p) => p.source));
  }

  /** List columns and team avatars for many zones: one call per source, whatever the number of zones (TC-ZONE-27). */
  async listFigures(ctx: AuthContext, zoneIds: readonly string[]) {
    const listSources: ZoneCountSource[] = ['restaurants', 'homemakers', 'delivery', 'customers'];
    const ports = this.sources.counts.filter((p) => listSources.includes(p.source));
    const [maps, team] = await Promise.all([
      Promise.all(ports.map((p) => p.countByZone(ctx, zoneIds))),
      this.sources.team.summaries(ctx, zoneIds),
    ]);
    const counts = new Map<string, ZoneCounts>();
    for (const id of zoneIds) {
      const merged = mergeFigures(maps.map((m) => m.get(id) ?? {}));
      const t = team.get(id);
      counts.set(id, {
        restaurants: merged.restaurants ?? 0,
        homemakers: merged.homemakers ?? 0,
        partners: merged.partners ?? 0,
        customers: merged.customers ?? 0,
        members: t?.total ?? 0,
      });
    }
    const missing = this.missing([...ports, { source: 'access', stub: this.sources.team.stub }]);
    return {
      counts,
      team: (id: string) => team.get(id) ?? { total: 0, top: [] },
      missing,
    };
  }

  /** Zones with no member, for the summary card; unknown (0, partial) while Access is a stub. */
  async zonesWithoutTeam(
    ctx: AuthContext,
    zoneIds: readonly string[],
  ): Promise<{ count: number; missing: ZoneCountSource[] }> {
    const team = await this.sources.team.summaries(ctx, zoneIds);
    if (this.sources.team.stub) return { count: 0, missing: ['access'] };
    return { count: zoneIds.filter((id) => (team.get(id)?.total ?? 0) === 0).length, missing: [] };
  }

  async impact(ctx: AuthContext, zoneId: string): Promise<ZoneImpact> {
    const [maps, team] = await Promise.all([
      Promise.all(this.sources.counts.map((p) => p.countByZone(ctx, [zoneId]))),
      this.sources.team.summaries(ctx, [zoneId]),
    ]);
    const merged = mergeFigures(maps.map((m) => m.get(zoneId) ?? {}));
    const counts: ZoneImpactCounts = {
      ...ZERO_IMPACT,
      ...merged,
      members: team.get(zoneId)?.total ?? 0,
    };
    const missing = this.missing([
      ...this.sources.counts,
      { source: 'access', stub: this.sources.team.stub },
    ]);
    return {
      zoneId,
      counts,
      impactVersion: impactVersionOf(counts, missing),
      partial: missing.length > 0,
      missingSources: missing,
    };
  }

  async team(ctx: AuthContext, zoneId: string) {
    const data = await this.sources.team.members(ctx, zoneId);
    const missing: ZoneCountSource[] = this.sources.team.stub ? ['access'] : [];
    return { data, partial: missing.length > 0, missingSources: missing };
  }

  async teamSummary(ctx: AuthContext, zoneId: string) {
    return (await this.sources.team.summaries(ctx, [zoneId])).get(zoneId) ?? { total: 0, top: [] };
  }

  /** R-ZONE-8: who is registered at the pincodes being removed. Reported, never moved. */
  async mismatches(ctx: AuthContext, zoneId: string, removed: readonly string[]) {
    const lists =
      removed.length === 0
        ? []
        : await Promise.all(
            this.sources.mismatches.map((p) => p.registeredAt(ctx, zoneId, removed)),
          );
    return { mismatches: lists.flat(), missing: this.missing(this.sources.mismatches) };
  }
}
