import type { PermissionKey } from '@zoauro/shared';
import type { AuthContext, ZoneLimits } from '../../../src/lib/authz';

// Scope-conformance harness (seed of the F1.6 authorization matrix harness). It drives a repository with the four
// standard actors over fixtures in zones A, B and C and reports every row or count that leaves the actor's scope.
// A repository that does not apply `zonesFor(ctx, ...)` MUST produce violations here (see leaky-repository.test.ts).

export const ZONE = {
  A: '0192f1d2-0000-7000-8000-00000000000a',
  B: '0192f1d2-0000-7000-8000-00000000000b',
  C: '0192f1d2-0000-7000-8000-00000000000c',
} as const;

export interface ZoneRow {
  id: string;
  zoneId: string;
}

/** Two rows in each zone, so "only A" and "A plus B" are distinguishable from "everything". */
export const FIXTURE_ROWS: ZoneRow[] = [
  { id: 'row-a1', zoneId: ZONE.A },
  { id: 'row-a2', zoneId: ZONE.A },
  { id: 'row-b1', zoneId: ZONE.B },
  { id: 'row-b2', zoneId: ZONE.B },
  { id: 'row-c1', zoneId: ZONE.C },
  { id: 'row-c2', zoneId: ZONE.C },
];

const LIMITS: ZoneLimits = { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false };

function zonal(
  userId: string,
  grants: Record<string, PermissionKey[]>,
  requested: readonly string[] | 'ALL' = 'ALL',
): AuthContext {
  return {
    userId,
    role: 'ZONAL_ADMIN',
    isSuperAdmin: false,
    assignedZoneIds: Object.keys(grants),
    permissionsByZone: new Map(Object.entries(grants).map(([z, keys]) => [z, new Set(keys)])),
    limitsByZone: new Map(Object.keys(grants).map((z) => [z, LIMITS])),
    requestedZoneIds: requested,
  };
}

export interface Actor {
  name: string;
  ctx: AuthContext;
  /** zones whose rows this actor may see when listing with the view permission */
  visibleZones: string[];
}

export function buildActors(view: PermissionKey): Actor[] {
  const superAdmin: AuthContext = {
    userId: 'sa',
    role: 'SUPER_ADMIN',
    isSuperAdmin: true,
    assignedZoneIds: [],
    permissionsByZone: new Map(),
    limitsByZone: new Map(),
    requestedZoneIds: 'ALL',
  };
  return [
    { name: 'SuperAdmin', ctx: superAdmin, visibleZones: [ZONE.A, ZONE.B, ZONE.C] },
    { name: 'Admin(A)', ctx: zonal('a', { [ZONE.A]: [view] }), visibleZones: [ZONE.A] },
    {
      name: 'Admin(A+B)',
      ctx: zonal('ab', { [ZONE.A]: [view], [ZONE.B]: [view] }),
      visibleZones: [ZONE.A, ZONE.B],
    },
    { name: 'Admin(none)', ctx: zonal('none', {}), visibleZones: [] },
    // assigned to A and B but may only VIEW in A: B must stay invisible (zone assigned, module not viewable there)
    {
      name: 'Admin(A view, B no view)',
      ctx: zonal('ab-noview', { [ZONE.A]: [view], [ZONE.B]: [] }),
      visibleZones: [ZONE.A],
    },
    // requested scope narrower than the assignment
    {
      name: 'Admin(A+B) requesting B',
      ctx: zonal('ab-req', { [ZONE.A]: [view], [ZONE.B]: [view] }, [ZONE.B]),
      visibleZones: [ZONE.B],
    },
  ];
}

/** What a repository must offer for the harness to test it. */
export interface RepositoryUnderTest {
  list(ctx: AuthContext): Promise<ZoneRow[]>;
  findById(ctx: AuthContext, id: string): Promise<ZoneRow | null>;
  count(ctx: AuthContext): Promise<number>;
}

/** Runs every check; returns one message per violation (empty = the repository stays inside every actor's scope). */
export async function runScopeHarness(
  repo: RepositoryUnderTest,
  view: PermissionKey,
): Promise<string[]> {
  const violations: string[] = [];
  for (const actor of buildActors(view)) {
    const visible = new Set(actor.visibleZones);
    const expected = FIXTURE_ROWS.filter((r) => visible.has(r.zoneId));

    const rows = await repo.list(actor.ctx);
    for (const r of rows) {
      if (!visible.has(r.zoneId))
        violations.push(`${actor.name}: list() leaked ${r.id} from another zone`);
    }
    if (rows.length !== expected.length) {
      violations.push(
        `${actor.name}: list() returned ${rows.length} rows, expected ${expected.length}`,
      );
    }

    const count = await repo.count(actor.ctx);
    if (count !== expected.length) {
      violations.push(`${actor.name}: count() returned ${count}, expected ${expected.length}`);
    }

    for (const row of FIXTURE_ROWS) {
      const found = await repo.findById(actor.ctx, row.id);
      if (visible.has(row.zoneId) && found === null)
        violations.push(`${actor.name}: findById(${row.id}) hid an in-scope row`);
      if (!visible.has(row.zoneId) && found !== null)
        violations.push(
          `${actor.name}: findById(${row.id}) returned an out-of-scope row (must be 404)`,
        );
    }
  }
  return violations;
}
