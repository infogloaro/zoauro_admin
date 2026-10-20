import { describe, expect, it } from 'vitest';
import { isGrantable, isOverrideGrantable } from '@zoauro/shared';
import { resolveAccess, type AccessAssignment } from '../../src/lib/authz/resolver';

// D155: commission:edit reaches a Zonal Admin only through a GRANT override in that zone, and only while the Control
// Panel switch access.commissionEditGrantable is on. A profile never gives it; DENY still wins; off = fail closed.

const Z = 'zone-a';
const assignment = (
  overrides: AccessAssignment['overrides'],
  profileCommission = false,
): AccessAssignment => ({
  zoneId: Z,
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
    permissions: [
      {
        module: 'restaurants',
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        canStatus: false,
      },
      ...(profileCommission
        ? [
            {
              module: 'commission',
              canView: true,
              canAdd: false,
              canEdit: true,
              canDelete: false,
              canStatus: false,
            },
          ]
        : []),
    ],
  },
  overrides,
});
const on = { commissionEdit: true };
const grant = [{ module: 'commission', action: 'EDIT' as const, effect: 'GRANT' as const }];

describe('D155 commission edit switch', () => {
  it('stays never grantable in the static table; the switch opens only commission:edit for overrides', () => {
    expect(isGrantable('commission', 'edit')).toBe(false);
    expect(isOverrideGrantable('commission', 'edit')).toBe(false);
    expect(isOverrideGrantable('commission', 'edit', on)).toBe(true);
    expect(isOverrideGrantable('commission', 'delete', on)).toBe(false);
    expect(isOverrideGrantable('settings', 'edit', on)).toBe(false);
  });

  it('a GRANT override gives it only while the switch is on', () => {
    expect(resolveAccess([assignment(grant)]).permissions[Z]).not.toContain('commission:edit');
    expect(
      resolveAccess([assignment(grant)], { commissionEdit: false }).permissions[Z],
    ).not.toContain('commission:edit');
    expect(resolveAccess([assignment(grant)], on).permissions[Z]).toContain('commission:edit');
  });

  it('a profile never gives it, even with the switch on; DENY wins', () => {
    expect(resolveAccess([assignment([], true)], on).permissions[Z]).not.toContain(
      'commission:edit',
    );
    const both = [
      ...grant,
      { module: 'commission', action: 'EDIT' as const, effect: 'DENY' as const },
    ];
    expect(resolveAccess([assignment(both)], on).permissions[Z]).not.toContain('commission:edit');
  });
});
