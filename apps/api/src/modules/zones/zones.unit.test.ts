import { describe, expect, it } from 'vitest';
import type { ZoneDto } from '@zoauro/shared';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { ImpactService, impactVersionOf, stubImpactSources } from './impact.service';
import { initialPincodes, planPincodeChange } from './pincodes.service';
import {
  pincodeRangeOf,
  redisZonesCacheVersion,
  zoneEventRows,
  ZONES_VERSION_KEY,
} from './zones.events';
import { missingForActivation } from './zones.service';

// Pure parts of the zones module (doc 53 sections 2.1, 2.5, 3, 7). The database behaviour is in tests/zones.

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(from + i));
const rows = (pincodes: string[], source: 'RANGE' | 'MANUAL' | 'IMPORT') =>
  pincodes.map((pincode) => ({ pincode, source }));

describe('initialPincodes', () => {
  it('range rows are RANGE, the list adds MANUAL rows, a pincode in both stays RANGE', () => {
    const out = initialPincodes({
      pincodeFrom: '560001',
      pincodeTo: '560003',
      pincodes: ['560003', '560010'],
    });
    expect(out).toEqual([
      { pincode: '560001', source: 'RANGE' },
      { pincode: '560002', source: 'RANGE' },
      { pincode: '560003', source: 'RANGE' },
      { pincode: '560010', source: 'MANUAL' },
    ]);
  });
  it('refuses a range over 2000 even when called directly', () => {
    expect(() => initialPincodes({ pincodeFrom: '700000', pincodeTo: '702000' })).toThrowError(
      AppError,
    );
  });
});

describe('planPincodeChange (range edits touch only RANGE rows)', () => {
  const current = [
    ...rows(range(560001, 100), 'RANGE'),
    ...rows(['560500'], 'MANUAL'),
    ...rows(['560600'], 'IMPORT'),
  ];

  it('narrowing the range removes only the RANGE rows outside it', () => {
    const plan = planPincodeChange(current, { range: { from: '560001', to: '560050' } });
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual(range(560051, 50));
  });
  it('widening the range adds RANGE rows, never duplicating a pincode the zone has', () => {
    const plan = planPincodeChange(current, { range: { from: '560001', to: '560102' } });
    expect(plan.add).toEqual(rows(['560101', '560102'], 'RANGE'));
    expect(plan.remove).toEqual([]);
  });
  it('a range that no longer covers a pincode the request also adds keeps it', () => {
    const plan = planPincodeChange(current, {
      range: { from: '560001', to: '560010' },
      add: ['560020'],
    });
    expect(plan.remove).not.toContain('560020');
  });
  it('remove takes rows of any source and wins over the range; unknown pincodes are no-ops', () => {
    const plan = planPincodeChange(current, {
      range: { from: '560001', to: '560100' },
      remove: ['560005', '560500', '560600', '999999'],
    });
    expect(plan.remove).toEqual(['560005', '560500', '560600']);
    expect(plan.add).toEqual([]);
  });
  it('adding what the zone has is a no-op; adding and removing the same pincode is refused', () => {
    expect(planPincodeChange(current, { add: ['560001', '560700'] }).add).toEqual(
      rows(['560700'], 'MANUAL'),
    );
    expect(() => planPincodeChange(current, { add: ['560700'], remove: ['560700'] })).toThrowError(
      /added and removed/,
    );
  });
});

describe('activation preconditions (§2.1)', () => {
  it('lists every missing item; a charge of 0 is fine', () => {
    expect(
      missingForActivation({
        name: 'A',
        city: 'B',
        state: 'C',
        pincodeCount: 1,
        deliveryChargePaise: 0,
      }),
    ).toEqual([]);
    expect(
      missingForActivation({
        name: ' ',
        city: '',
        state: null,
        pincodeCount: 0,
        deliveryChargePaise: null,
      }),
    ).toEqual(['name', 'city', 'state', 'pincodes', 'deliveryCharge']);
  });
});

const zone = (over: Partial<ZoneDto> = {}): ZoneDto => ({
  id: '0192f1d2-0000-7000-8000-000000000001',
  name: 'Chennai Central',
  code: 'CHN',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincodeFrom: '600001',
  pincodeTo: '600010',
  pincodeCount: 10,
  deliveryChargePaise: 2500,
  status: 'ACTIVE',
  colorHex: '#2563EB',
  description: null,
  version: 4,
  activatedAt: null,
  deactivatedAt: null,
  deactivationReason: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
  ...over,
});

describe('events (doc 53 section 2.5)', () => {
  it('pincodeRange: the range, "multiple", or "" for no pincodes', () => {
    expect(pincodeRangeOf(zone(), true)).toBe('600001-600010');
    expect(pincodeRangeOf(zone(), false)).toBe('multiple');
    expect(pincodeRangeOf(zone({ pincodeFrom: null, pincodeTo: null }), true)).toBe('multiple');
    expect(pincodeRangeOf(zone({ pincodeCount: 0 }), true)).toBe('');
  });
  it('zone.updated carries exactly the catalogue fields; admin.zones_changed {zoneId, change}', () => {
    const [updated, internal] = zoneEventRows({
      zone: zone(),
      change: 'delivery_charge_changed',
      actorId: 'actor',
      occurredAt: new Date('2026-10-13T10:00:00Z'),
      onlyRangeRows: true,
    });
    expect(updated?.eventType).toBe('zone.updated');
    expect(updated?.payload).toMatchObject({
      eventId: updated?.id,
      schemaVersion: 1,
      occurredAt: '2026-10-13T10:00:00.000Z',
      aggregate: { type: 'zone', id: zone().id, version: 4 },
      data: {
        zoneId: zone().id,
        name: 'Chennai Central',
        status: 'ACTIVE',
        pincodeRange: '600001-600010',
        deliveryChargePaise: 2500,
      },
    });
    expect(internal?.eventType).toBe('admin.zones_changed');
    expect(internal?.payload['data']).toEqual({
      zoneId: zone().id,
      change: 'delivery_charge_changed',
    });
  });
  it('a deleted zone is announced as INACTIVE with no pincodes', () => {
    const [updated] = zoneEventRows({
      zone: zone(),
      change: 'deleted',
      actorId: 'a',
      occurredAt: new Date(),
      onlyRangeRows: true,
    });
    expect(updated?.payload['data']).toMatchObject({ status: 'INACTIVE', pincodeRange: '' });
  });
  it('the cache counter is the zones:version key', async () => {
    const keys: string[] = [];
    await redisZonesCacheVersion({ incr: async (k) => (keys.push(k), keys.length) }).bump();
    expect(keys).toEqual([ZONES_VERSION_KEY]);
    expect(ZONES_VERSION_KEY).toBe('zones:version');
  });
});

describe('impact with stub ports (doc 53 section 7)', () => {
  const ctx = { userId: 'u', isSuperAdmin: true } as unknown as AuthContext;
  it('zeros, partial:true and every missing module named: never zeros that look complete', async () => {
    const impact = await new ImpactService(stubImpactSources()).impact(ctx, zone().id);
    expect(impact.partial).toBe(true);
    expect(impact.missingSources.sort()).toEqual(
      [
        'access',
        'customers',
        'delivery',
        'homemakers',
        'orders',
        'payouts',
        'refunds',
        'registrations',
        'restaurants',
      ].sort(),
    );
    expect(impact.counts.openOrders).toBe(0);
  });
  it('impactVersion changes when any number changes and ignores key order', () => {
    const base = {
      openOrders: 1,
      openOrdersByStatus: { PLACED: 1, READY: 0 },
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
    const v = impactVersionOf(base, []);
    expect(impactVersionOf({ ...base, openOrdersByStatus: { READY: 0, PLACED: 1 } }, [])).toBe(v);
    expect(impactVersionOf({ ...base, members: 1 }, [])).not.toBe(v);
    expect(impactVersionOf(base, ['orders'])).not.toBe(v);
  });
});
