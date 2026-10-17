import type { PermissionKey } from '@zoauro/shared';
import { describe, expect, it } from 'vitest';
import type { AuthContext, ZoneLimits } from '../authz';
import { AppError } from '../errors';
import { CSV_BOM, csvCell, csvHeader, csvRows, rupees } from './csv';
import { exportScope, requestedZonesOf, sameScope } from './scope';

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(1234)).toBe('1234');
  });

  it('defuses spreadsheet formulas (doc 13)', () => {
    for (const s of ['=1+1', '+91 98', '-5', '@SUM(A1)', '\tx', '\rx'])
      expect(csvCell(s).replace(/^"/, '').startsWith(`'`)).toBe(true);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5)).toBe('-5'); // numbers are values, not text a spreadsheet would run
  });

  it('writes CRLF rows under a header; rupees have two decimals and no grouping', () => {
    const cols = [
      { header: 'Name', value: (r: { n: string; p: number }) => r.n },
      { header: 'Total (INR)', value: (r: { n: string; p: number }) => rupees(r.p) },
    ];
    expect(csvHeader(cols) + csvRows(cols, [{ n: 'Asha', p: 123456 }])).toBe(
      'Name,Total (INR)\r\nAsha,1234.56\r\n',
    );
    expect(CSV_BOM).toBe('﻿');
  });
});

const A = '0192f1d2-0000-7000-8000-00000000000a';
const B = '0192f1d2-0000-7000-8000-00000000000b';
const limits = (canExport: boolean): ZoneLimits => ({
  perRefund: 0,
  dailyRefund: 0,
  canReveal: false,
  canExport,
});

function zonal(
  zones: Record<string, { keys: PermissionKey[]; canExport: boolean }>,
  requested: string[] | 'ALL' = 'ALL',
): AuthContext {
  return {
    userId: 'u',
    role: 'ZONAL_ADMIN',
    isSuperAdmin: false,
    assignedZoneIds: Object.keys(zones),
    permissionsByZone: new Map(Object.entries(zones).map(([z, v]) => [z, new Set(v.keys)])),
    limitsByZone: new Map(Object.entries(zones).map(([z, v]) => [z, limits(v.canExport)])),
    requestedZoneIds: requested,
  };
}

const forbidden = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError && e.code === 'FORBIDDEN';
  }
  return false;
};

describe('exportScope (doc 36, D129)', () => {
  it('Super Admin: all zones, or the zones asked for', () => {
    const sa: AuthContext = { ...zonal({}), role: 'SUPER_ADMIN', isSuperAdmin: true };
    expect(exportScope(sa, 'orders:view')).toEqual({ kind: 'ALL' });
    expect(exportScope({ ...sa, requestedZoneIds: [B, A] }, 'orders:view')).toEqual({
      kind: 'ZONES',
      zoneIds: [B, A],
    });
  });

  it('Zonal: the zones it may view, each with canExport', () => {
    const ctx = zonal({
      [A]: { keys: ['orders:view'], canExport: true },
      [B]: { keys: ['orders:view'], canExport: true },
    });
    expect(exportScope(ctx, 'orders:view')).toEqual({ kind: 'ZONES', zoneIds: [A, B].sort() });
  });

  it('Zonal: a viewable zone without canExport refuses the whole export; asking for the other zone works', () => {
    const zones = {
      [A]: { keys: ['orders:view'] as PermissionKey[], canExport: true },
      [B]: { keys: ['orders:view'] as PermissionKey[], canExport: false },
    };
    expect(forbidden(() => exportScope(zonal(zones), 'orders:view'))).toBe(true);
    expect(exportScope(zonal(zones, [A]), 'orders:view')).toEqual({ kind: 'ZONES', zoneIds: [A] });
  });

  it('Zonal: a zone without the view permission is not exported (canExport alone is not enough)', () => {
    const ctx = zonal({
      [A]: { keys: ['orders:view'], canExport: true },
      [B]: { keys: ['restaurants:view'], canExport: true },
    });
    expect(exportScope(ctx, 'orders:view')).toEqual({ kind: 'ZONES', zoneIds: [A] });
  });

  it('Zonal with no viewable zone: 403', () => {
    expect(forbidden(() => exportScope(zonal({}), 'orders:view'))).toBe(true);
  });

  it('sameScope ignores order; requestedZonesOf rebuilds the request', () => {
    expect(sameScope({ kind: 'ZONES', zoneIds: [A, B] }, { kind: 'ZONES', zoneIds: [B, A] })).toBe(
      true,
    );
    expect(sameScope({ kind: 'ZONES', zoneIds: [A] }, { kind: 'ZONES', zoneIds: [A, B] })).toBe(
      false,
    );
    expect(sameScope({ kind: 'ALL' }, { kind: 'ZONES', zoneIds: [A] })).toBe(false);
    expect(requestedZonesOf({ kind: 'ALL' })).toBe('ALL');
    expect(requestedZonesOf({ kind: 'ZONES', zoneIds: [A] })).toEqual([A]);
  });
});
