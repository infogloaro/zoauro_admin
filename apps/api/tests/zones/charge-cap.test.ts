import { describe, expect, it } from 'vitest';
import type { CreateZoneInput } from '@zoauro/shared';
import type { AuthContext } from '../../src/lib/authz';
import { ZonesService } from '../../src/modules/zones/zones.service';

// D165: a zone's delivery charge may not exceed the Super Admin's cap (settings zones.deliveryChargeCapPaise, default
// ₹1 000, never above the database ceiling). Checked before anything is written.

const ctx = { userId: 'sa', role: 'SUPER_ADMIN', isSuperAdmin: true } as unknown as AuthContext;
const REACHED_DB = new Error('reached the database');
const service = (cap?: () => Promise<number>) =>
  new ZonesService({
    db: {
      transaction: () => Promise.reject(REACHED_DB),
    } as unknown as ConstructorParameters<typeof ZonesService>[0]['db'],
    impact: {} as unknown as ConstructorParameters<typeof ZonesService>[0]['impact'],
    cache: { bump: async () => undefined } as unknown as ConstructorParameters<
      typeof ZonesService
    >[0]['cache'],
    clock: () => new Date(0),
    ...(cap ? { deliveryChargeCap: cap } : {}),
  });
const input = (deliveryChargePaise: number) =>
  ({
    name: 'Cap test',
    code: 'CAP',
    city: 'Chennai',
    state: 'Tamil Nadu',
    deliveryChargePaise,
    status: 'UPCOMING',
    colorHex: '#000000',
    pincodes: [],
  }) as unknown as CreateZoneInput;

describe('zones delivery charge cap (D165)', () => {
  it('above the cap: 422 ABOVE_ZONE_CAP with the cap, nothing written', async () => {
    await expect(service(async () => 50_000).create(ctx, input(50_001))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'deliveryChargePaise', issue: 'ABOVE_ZONE_CAP' }],
    });
  });

  it('at the cap the write goes ahead; no reader or a failing reader means the ₹1 000 ceiling', async () => {
    await expect(service(async () => 50_000).create(ctx, input(50_000))).rejects.toBe(REACHED_DB);
    await expect(service().create(ctx, input(100_000))).rejects.toBe(REACHED_DB);
    await expect(
      service(() => Promise.reject(new Error('settings down'))).create(ctx, input(100_000)),
    ).rejects.toBe(REACHED_DB);
  });
});
