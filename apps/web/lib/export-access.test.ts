import type { MeResponse } from '@zoauro/shared';
import { describe, expect, it } from 'vitest';
import { canExportList } from './export-access';

// D149: the Export button is offered to a Super Admin, and to a Zonal Admin only with <module>:export in a zone whose
// export switch is on.

const zone = (permissions: string[], canExport: boolean) => ({
  zoneId: '0192f1d2-0000-7000-8000-00000000000a',
  name: 'Anna Nagar',
  code: 'ANN',
  colorHex: '#123456',
  status: 'ACTIVE',
  permissions,
  limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport },
});
const me = (global: boolean, zones: ReturnType<typeof zone>[]) =>
  ({ permissions: { global, zones } }) as unknown as MeResponse;

describe('canExportList', () => {
  it('Super Admin: always; Zonal Admin: the module export and the zone switch, in the same zone', () => {
    expect(canExportList(me(true, []), 'orders')).toBe(true);
    // D178: a non-primary Super Admin only with the exports area
    const sa = (areas: string[]) =>
      ({
        permissions: { global: true, zones: [] },
        controlAreas: { isPrimary: false, areas },
      }) as unknown as MeResponse;
    expect(canExportList(sa(['settings.refunds']), 'orders')).toBe(false);
    expect(canExportList(sa(['exports']), 'orders')).toBe(true);
    expect(canExportList(me(false, [zone(['orders:view', 'orders:export'], true)]), 'orders')).toBe(
      true,
    );
    // the switch is off in that zone
    expect(canExportList(me(false, [zone(['orders:export'], false)]), 'orders')).toBe(false);
    // the right is in one zone, the switch in another
    expect(
      canExportList(
        me(false, [zone(['orders:export'], false), zone(['orders:view'], true)]),
        'orders',
      ),
    ).toBe(false);
    expect(canExportList(me(false, [zone(['customers:export'], true)]), 'orders')).toBe(false);
  });
});
