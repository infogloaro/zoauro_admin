import { describe, expect, it } from 'vitest';
import { findGrantViolations, isGrantable, type PermissionKey } from '@zoauro/shared';
import { AppError } from '../../src/lib/errors';
import {
  assertCanRead,
  assertCanWrite,
  can,
  holdsAnywhere,
  resolveAccess,
  scopeKey,
  zonesFor,
  type AccessAssignment,
  type AuthContext,
  type OverrideAction,
} from '../../src/lib/authz';
import { ZONE } from './support/scope-harness';

function assignment(
  zoneId: string,
  grants: Record<string, string[]>,
  overrides: { module: string; action: OverrideAction; effect: 'GRANT' | 'DENY' }[] = [],
  extra: Partial<AccessAssignment> = {},
): AccessAssignment {
  return {
    zoneId,
    perRefundLimit: null,
    dailyRefundLimit: null,
    canReveal: null,
    canExport: null,
    profile: {
      deleted: false,
      defaultPerRefundLimit: null,
      defaultDailyRefundLimit: null,
      defaultCanReveal: false,
      defaultCanExport: false,
      permissions: Object.entries(grants).map(([module, actions]) => ({
        module,
        canView: actions.includes('view'),
        canAdd: actions.includes('add'),
        canEdit: actions.includes('edit'),
        canDelete: actions.includes('delete'),
        canStatus: actions.includes('status'),
      })),
    },
    overrides,
    ...extra,
  };
}

const keys = (a: ReturnType<typeof resolveAccess>, zone: string): string[] =>
  a.permissions[zone] ?? [];

describe('TC-AC-5 deny override vs profile grant: deny wins', () => {
  it('a DENY override removes a permission the profile grants', () => {
    const r = resolveAccess([
      assignment(ZONE.A, { orders: ['view', 'edit'], payments: ['view'] }, [
        { module: 'orders', action: 'EDIT', effect: 'DENY' },
      ]),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view', 'payments:view']);
  });

  it('deny wins over a GRANT override on the same action, whatever the row order', () => {
    const deny = { module: 'orders', action: 'DELETE' as const, effect: 'DENY' as const };
    const grant = { module: 'orders', action: 'DELETE' as const, effect: 'GRANT' as const };
    for (const overrides of [
      [deny, grant],
      [grant, deny],
    ]) {
      const r = resolveAccess([assignment(ZONE.A, { orders: ['view'] }, overrides)]);
      expect(keys(r, ZONE.A)).not.toContain('orders:delete');
    }
  });

  it('a GRANT override adds a grantable permission the profile lacks', () => {
    const r = resolveAccess([
      assignment(ZONE.A, { orders: ['view'] }, [
        { module: 'menu', action: 'EDIT', effect: 'GRANT' },
      ]),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['menu:edit', 'orders:view']);
  });

  it('payments:view denied everywhere (doc 04 example): denied in every zone it is set for', () => {
    const deny = [{ module: 'payments', action: 'VIEW' as const, effect: 'DENY' as const }];
    const r = resolveAccess([
      assignment(ZONE.A, { orders: ['view'], payments: ['view'] }, deny),
      assignment(ZONE.B, { orders: ['view'], payments: ['view'] }, deny),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view']);
    expect(keys(r, ZONE.B)).toEqual(['orders:view']);
  });

  it('an override in zone A does not change zone B (permissions are per member per zone)', () => {
    const r = resolveAccess([
      assignment(ZONE.A, { orders: ['view', 'edit'] }, [
        { module: 'orders', action: 'EDIT', effect: 'DENY' },
      ]),
      assignment(ZONE.B, { orders: ['view', 'edit'] }),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view']);
    expect(keys(r, ZONE.B)).toEqual(['orders:edit', 'orders:view']);
  });
});

describe('TC-AC-6 non-grantable modules cannot reach a Zonal Admin', () => {
  const NON_GRANTABLE: [string, string][] = [
    ['zones', 'edit'],
    ['access', 'edit'],
    ['settings', 'edit'],
    ['commission', 'edit'],
  ];

  it('validation (422 in the Access Control module) names every offender', () => {
    const violations = findGrantViolations(
      NON_GRANTABLE.map(([module, action]) => ({ module, action })),
    );
    expect(violations).toEqual(
      NON_GRANTABLE.map(([module, action]) => ({ module, action, reason: 'NOT_GRANTABLE' })),
    );
  });

  it('accepts what doc 04 allows and reports unknown modules and actions', () => {
    expect(
      findGrantViolations([
        { module: 'orders', action: 'status' },
        { module: 'payments', action: 'view' },
        { module: 'settlements', action: 'edit' },
      ]),
    ).toEqual([]);
    expect(findGrantViolations([{ module: 'spaceships', action: 'view' }])).toEqual([
      { module: 'spaceships', action: 'view', reason: 'UNKNOWN_MODULE' },
    ]);
    expect(findGrantViolations([{ module: 'orders', action: 'fly' }])).toEqual([
      { module: 'orders', action: 'fly', reason: 'UNKNOWN_ACTION' },
    ]);
  });

  it('the matrix follows doc 04: payments and payouts are view-only, refunds view/add, settlements view/add/edit', () => {
    expect(isGrantable('payments', 'edit')).toBe(false);
    expect(isGrantable('payouts', 'edit')).toBe(false);
    expect(isGrantable('refunds', 'add')).toBe(true);
    expect(isGrantable('refunds', 'status')).toBe(false);
    expect(isGrantable('settlements', 'delete')).toBe(false);
    expect(isGrantable('audit', 'view')).toBe(false); // entity Activity is derived, audit:view is not grantable
    expect(isGrantable('integrations', 'view')).toBe(false); // D57
    expect(isGrantable('orders', 'status')).toBe(true);
  });

  it('even if the database holds such grants (profile or override), the resolver drops them for a Zonal Admin', () => {
    const everything = ['view', 'add', 'edit', 'delete', 'status'];
    const r = resolveAccess([
      assignment(
        ZONE.A,
        {
          orders: ['view'],
          zones: everything,
          access: everything,
          settings: everything,
          commission: everything,
          admins: everything,
        },
        NON_GRANTABLE.map(([module, action]) => ({
          module,
          action: action.toUpperCase() as OverrideAction,
          effect: 'GRANT' as const,
        })),
      ),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view']);
  });

  it('profile flags beyond what is grantable are trimmed (payments:edit in a profile does nothing)', () => {
    const r = resolveAccess([
      assignment(ZONE.A, { payments: ['view', 'edit', 'delete'], refunds: ['view', 'status'] }),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['payments:view', 'refunds:view']);
  });

  it('a DENY on a non-grantable module is harmless', () => {
    const r = resolveAccess([
      assignment(ZONE.A, { orders: ['view'] }, [
        { module: 'zones', action: 'EDIT', effect: 'DENY' },
      ]),
    ]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view']);
  });
});

describe('resolver: limits, deleted profiles, unknown data', () => {
  it('assignment limits override the profile defaults; null falls back to the profile; nothing configured means 0 / false', () => {
    const base = assignment(ZONE.A, { orders: ['view'] });
    const withDefaults = {
      ...base,
      profile: {
        ...base.profile,
        defaultPerRefundLimit: 50_000,
        defaultDailyRefundLimit: 500_000,
        defaultCanReveal: true,
      },
    };
    const r = resolveAccess([
      withDefaults,
      {
        ...withDefaults,
        zoneId: ZONE.B,
        perRefundLimit: 80_000,
        dailyRefundLimit: 0,
        canReveal: false,
        canExport: true,
      },
      assignment(ZONE.C, { orders: ['view'] }),
    ]);
    expect(r.limits[ZONE.A]).toEqual({
      perRefund: 50_000,
      dailyRefund: 500_000,
      canReveal: true,
      canExport: false,
    });
    expect(r.limits[ZONE.B]).toEqual({
      perRefund: 80_000,
      dailyRefund: 0,
      canReveal: false,
      canExport: true,
    });
    expect(r.limits[ZONE.C]).toEqual({
      perRefund: 0,
      dailyRefund: 0,
      canReveal: false,
      canExport: false,
    });
  });

  it('a soft-deleted profile grants nothing but the zone stays assigned', () => {
    const a = assignment(ZONE.A, { orders: ['view', 'edit'] });
    const r = resolveAccess([{ ...a, profile: { ...a.profile, deleted: true } }]);
    expect(r.assignedZoneIds).toEqual([ZONE.A]);
    expect(keys(r, ZONE.A)).toEqual([]);
  });

  it('ignores unknown module keys stored in the database', () => {
    const r = resolveAccess([assignment(ZONE.A, { orders: ['view'], teleport: ['view', 'edit'] })]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view']);
  });

  it('two active rows for one zone resolve to the intersection and the lower limits (fail closed)', () => {
    const r = resolveAccess([
      assignment(ZONE.A, { orders: ['view', 'edit'] }, [], {
        perRefundLimit: 90_000,
        canReveal: true,
      }),
      assignment(ZONE.A, { orders: ['view'] }, [], { perRefundLimit: 10_000, canReveal: false }),
    ]);
    expect(r.assignedZoneIds).toEqual([ZONE.A]);
    expect(keys(r, ZONE.A)).toEqual(['orders:view']);
    expect(r.limits[ZONE.A]).toMatchObject({ perRefund: 10_000, canReveal: false });
  });

  it('no assignments: no zones, no permissions', () => {
    expect(resolveAccess([])).toEqual({ assignedZoneIds: [], permissions: {}, limits: {} });
  });
});

function ctxOf(
  grants: Record<string, PermissionKey[]>,
  requested: readonly string[] | 'ALL' = 'ALL',
  superAdmin = false,
): AuthContext {
  return {
    userId: 'u',
    role: superAdmin ? 'SUPER_ADMIN' : 'ZONAL_ADMIN',
    isSuperAdmin: superAdmin,
    assignedZoneIds: Object.keys(grants),
    permissionsByZone: new Map(Object.entries(grants).map(([z, k]) => [z, new Set(k)])),
    limitsByZone: new Map(),
    requestedZoneIds: requested,
  };
}

describe('can, zonesFor, assertCanRead, assertCanWrite', () => {
  const member = ctxOf({
    [ZONE.A]: ['orders:view', 'orders:edit'],
    [ZONE.B]: ['orders:view'], // read-only in B
  });

  it('can() is per zone (TC-AC-1: read-only in B, full in A)', () => {
    expect(can(member, 'orders:edit', ZONE.A)).toBe(true);
    expect(can(member, 'orders:edit', ZONE.B)).toBe(false);
    expect(can(member, 'orders:view', ZONE.C)).toBe(false);
    expect(can(ctxOf({}, 'ALL', true), 'zones:edit', ZONE.C)).toBe(true); // Super Admin
  });

  it('zonesFor() = requested ∩ zones holding the permission (TC-AC-2)', () => {
    expect(zonesFor(member, 'orders:view')).toEqual({ kind: 'ZONES', zoneIds: [ZONE.A, ZONE.B] });
    expect(zonesFor(member, 'orders:edit')).toEqual({ kind: 'ZONES', zoneIds: [ZONE.A] });
    expect(zonesFor(member, 'payments:view')).toEqual({ kind: 'ZONES', zoneIds: [] });
    expect(zonesFor({ ...member, requestedZoneIds: [ZONE.B] }, 'orders:view')).toEqual({
      kind: 'ZONES',
      zoneIds: [ZONE.B],
    });
    expect(zonesFor({ ...member, requestedZoneIds: [ZONE.B] }, 'orders:edit')).toEqual({
      kind: 'ZONES',
      zoneIds: [],
    });
  });

  it('Super Admin: no filter unless a zone was requested', () => {
    expect(zonesFor(ctxOf({}, 'ALL', true), 'orders:view')).toEqual({ kind: 'ALL' });
    expect(zonesFor(ctxOf({}, [ZONE.C], true), 'orders:view')).toEqual({
      kind: 'ZONES',
      zoneIds: [ZONE.C],
    });
  });

  it('read in an unassigned zone or an unviewable module is 404', () => {
    expect(() => assertCanRead(member, 'orders:view', ZONE.A)).not.toThrow();
    for (const [key, zone] of [
      ['orders:view', ZONE.C],
      ['payments:view', ZONE.A],
    ] as const) {
      try {
        assertCanRead(member, key, zone);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).status).toBe(404);
      }
    }
  });

  it('write: unassigned zone is 404, assigned zone without the action is 403 (TC-AC-1)', () => {
    expect(() => assertCanWrite(member, 'orders:edit', ZONE.A)).not.toThrow();
    const statusOf = (key: PermissionKey, zone: string): number => {
      try {
        assertCanWrite(member, key, zone);
        return 200;
      } catch (e) {
        return (e as AppError).status;
      }
    };
    expect(statusOf('orders:edit', ZONE.B)).toBe(403);
    expect(statusOf('orders:edit', ZONE.C)).toBe(404);
    expect(statusOf('orders:delete', ZONE.A)).toBe(403);
    expect(() => assertCanWrite(ctxOf({}, 'ALL', true), 'orders:edit', ZONE.C)).not.toThrow();
  });

  it('holdsAnywhere() is the route-level check for write actions', () => {
    expect(holdsAnywhere(member, 'orders:edit')).toBe(true);
    expect(holdsAnywhere(member, 'orders:delete')).toBe(false);
    expect(holdsAnywhere(ctxOf({}), 'orders:view')).toBe(false);
  });

  it('scopeKey() is stable for the same set and differs between scopes (cache isolation, doc 36 §5.4)', () => {
    const ab = scopeKey({ kind: 'ZONES', zoneIds: [ZONE.A, ZONE.B] });
    expect(scopeKey({ kind: 'ZONES', zoneIds: [ZONE.B, ZONE.A] })).toBe(ab);
    expect(scopeKey({ kind: 'ZONES', zoneIds: [ZONE.A] })).not.toBe(ab);
    expect(scopeKey({ kind: 'ALL' })).toBe('ALL');
    expect(scopeKey({ kind: 'ZONES', zoneIds: [] })).not.toBe('ALL');
  });
});
