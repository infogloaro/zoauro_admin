import { describe, expect, it } from 'vitest';
import { SettingsReader } from '../../src/modules/settings/settings.service';

// SettingsReader accessors of the Control Panel keys (D145, D152, D154, D155, D161, D163, D165, D167): zone value ??
// platform value ?? the decided default; a stored value that fails its schema falls back to the next source.

type Stored = { value: unknown; version: number; updatedAt: Date; updatedBy: null };
function reader(
  platform: Record<string, unknown>,
  zones: Record<string, Record<string, unknown>> = {},
) {
  const repo = {
    platformValues: async (keys: readonly string[]) =>
      new Map<string, Stored>(
        keys
          .filter((k) => k in platform)
          .map((k) => [
            k,
            { value: platform[k], version: 1, updatedAt: new Date(0), updatedBy: null },
          ]),
      ),
    zoneValues: async (key: string, zoneIds: readonly string[]) =>
      new Map<string, unknown>(
        zoneIds.filter((z) => zones[key]?.[z] !== undefined).map((z) => [z, zones[key]?.[z]]),
      ),
  };
  return new SettingsReader({
    repo: repo as unknown as ConstructorParameters<typeof SettingsReader>[0]['repo'],
    now: () => 0,
  });
}
const Z = '00000000-0000-7000-8000-000000000001';
const Y = '00000000-0000-7000-8000-000000000002';

describe('Control Panel settings reader', () => {
  it('defaults: the decided rules', async () => {
    const r = reader({});
    expect(await r.unpaidTimeoutMinutes(Z, 'ONLINE')).toBe(15);
    expect(await r.unpaidTimeoutMinutes(Z, 'WALLET')).toBe(15);
    expect(await r.unpaidTimeoutMinutes(Z, 'COD')).toBeNull(); // COD is visible at once
    expect(await r.cancellationRules(Z)).toEqual({
      CUSTOMER: { allowedBefore: 'ACCEPTED', reasonRequired: false },
      VENDOR: { allowedBefore: 'PREPARING', reasonRequired: true },
      ADMIN: { allowedBefore: 'OUT_FOR_DELIVERY', reasonRequired: true },
    });
    expect(await r.preorderRules(Z)).toMatchObject({ minLeadMinutes: 60, maxReschedules: 2 });
    expect(await r.autoAssign(Z)).toEqual({ enabled: false, radiusKm: 5, offerTimeoutSeconds: 60 });
    expect(await r.payoutCycleDays(Z)).toBe(7);
    expect(await r.deliveryChargeCapPaise()).toBe(100_000);
    expect(await r.commissionEditGrantable()).toBe(false);
    expect(await r.sessionRemember()).toEqual({ rememberDays: 7, rememberIdleHours: 8 });
    expect(await r.onboardingCatalogue('HOTEL')).toBeNull();
    expect(
      (await r.onboardingCatalogue('HOMEMAKER'))?.filter((d) => !d.mandatory).map((d) => d.code),
    ).toEqual(['PAN', 'KITCHEN_PHOTOS']);
  });

  it('refund rules: the D146 defaults, a zone value wins (D180, D187)', async () => {
    const d = await reader({}).refundRules(Z);
    expect(d.decisionTimeLimitMinutes).toBe(240);
    expect(d.reasons.find((r) => r.code === 'GOODWILL')?.bearer).toBe('PLATFORM');
    const own = { ...d, decisionTimeLimitMinutes: 60 };
    expect(
      (await reader({}, { 'refunds.rules': { [Z]: own } }).refundRules(Z)).decisionTimeLimitMinutes,
    ).toBe(60);
  });

  it('order stage targets and onboarding age warnings (D182, D170)', async () => {
    const r = reader(
      {},
      {
        'orders.sla': {
          [Z]: {
            acceptMinutes: 3,
            prepareMinutes: 20,
            readyToAssignMinutes: 5,
            assignedToPickupMinutes: 10,
            outForDeliveryMinutes: 30,
          },
        },
      },
    );
    expect((await r.orderSla(Z)).acceptMinutes).toBe(3);
    expect(await r.orderSla(Y)).toEqual({
      acceptMinutes: 5,
      prepareMinutes: 30,
      readyToAssignMinutes: 10,
      assignedToPickupMinutes: 15,
      outForDeliveryMinutes: 40,
    });
    expect(await r.onboardingAgeWarnings()).toEqual({ warnHours: 24, lateHours: 48 });
  });

  it('support SLA: default, then a zone override', async () => {
    expect(await reader({}).supportSla(Z)).toEqual({
      firstResponseMinutes: 120,
      resolutionMinutes: 1440,
      escalationMinutes: 720,
      reopenWithinDays: 7,
      assignment: 'ROUND_ROBIN',
    });
    const own = {
      firstResponseMinutes: 30,
      resolutionMinutes: 600,
      escalationMinutes: 300,
      reopenWithinDays: 3,
      assignment: 'LEAST_BUSY',
    };
    const r = reader({}, { 'support.sla': { [Z]: own } });
    expect(await r.supportSla(Z)).toEqual(own);
    expect((await r.supportSla(Y)).assignment).toBe('ROUND_ROBIN');
  });

  it('a zone value wins in its zone only; the platform value elsewhere', async () => {
    const r = reader(
      {
        'payouts.cycleDays': { days: 14 },
        'delivery.autoAssign': { enabled: true, radiusKm: 3, offerTimeoutSeconds: 45 },
      },
      { 'payouts.cycleDays': { [Z]: { days: 3 } } },
    );
    expect(await r.payoutCycleDays(Z)).toBe(3);
    expect(await r.payoutCycleDays(Y)).toBe(14);
    expect(await r.autoAssign(Y)).toMatchObject({ enabled: true, radiusKm: 3 });
  });

  it('a platform-only key ignores zone rows; an invalid stored value falls back to the default', async () => {
    const r = reader(
      {
        'zones.deliveryChargeCapPaise': { capPaise: -5 },
        'access.commissionEditGrantable': { enabled: true },
      },
      { 'access.commissionEditGrantable': { [Z]: { enabled: false } } },
    );
    expect(await r.deliveryChargeCapPaise()).toBe(100_000);
    expect(await r.commissionEditGrantable()).toBe(true);
  });

  it('a value saved before D145 is upgraded: every listed code mandatory, homemakers from HOME_FOOD', async () => {
    const r = reader({
      'onboarding.documents': {
        RESTAURANT: ['FSSAI', 'PAN'],
        DELIVERY_PARTNER: ['ID_PROOF'],
        HOME_FOOD: null,
      },
    });
    expect(await r.onboardingCatalogue('RESTAURANT')).toEqual([
      { code: 'FSSAI', label: 'FSSAI licence', mandatory: true },
      { code: 'PAN', label: 'PAN card', mandatory: true },
    ]);
    expect(await r.onboardingCatalogue('HOMEMAKER')).toBeNull();
    // the shape the vendor and partner modules read: mandatory codes only
    expect(await r.onboardingDocuments()).toEqual({
      RESTAURANT: ['FSSAI', 'PAN'],
      HOME_FOOD: null,
      DELIVERY_PARTNER: ['ID_PROOF'],
      HOTEL: null,
    });
  });

  it('the vendor-module shape drops optional documents', async () => {
    const lists = await reader({}).onboardingDocuments();
    expect(lists.HOME_FOOD).toEqual([
      'FSSAI_REGISTRATION',
      'ID_PROOF',
      'ADDRESS_PROOF',
      'BANK_DETAILS',
    ]);
    expect(lists.RESTAURANT).toEqual(['FSSAI', 'GST', 'PAN', 'BANK_DETAILS']);
  });
});
