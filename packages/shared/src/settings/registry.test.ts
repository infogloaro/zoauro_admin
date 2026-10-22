import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ONBOARDING_DOCUMENTS,
  SETTINGS,
  deliveryAutoAssignSchema,
  onboardingDocumentsSchema,
  orderCancellationRulesSchema,
  orderPreorderSchema,
  orderUnpaidTimeoutSchema,
  payoutCycleSchema,
  sessionRememberSchema,
  settingDef,
  zoneDeliveryChargeCapSchema,
} from './registry';

// Control Panel keys (D145, D152, D154–D156, D161, D163, D165, D167): every default passes its own schema; bounds.

describe('settings registry', () => {
  it('every default passes its schema; keys are unique', () => {
    for (const s of SETTINGS) expect(s.schema.safeParse(s.default).success, s.key).toBe(true);
    expect(new Set(SETTINGS.map((s) => s.key)).size).toBe(SETTINGS.length);
  });

  it('re-auth and zone override per D112 / the decisions', () => {
    expect(settingDef('access.commissionEditGrantable')).toMatchObject({
      reauth: 'STRONG',
      zoneOverride: false,
      default: { enabled: false },
    });
    expect(settingDef('sessions.remember')?.reauth).toBe('STRONG');
    expect(settingDef('zones.deliveryChargeCapPaise')).toMatchObject({
      zoneOverride: false,
      default: { capPaise: 100_000 },
    });
    for (const k of [
      'orders.unpaidTimeoutMinutes',
      'orders.preorder',
      'delivery.autoAssign',
      'payouts.cycleDays',
      'delivery.codLimitPaise',
      'orders.cancelReasons',
    ])
      expect(settingDef(k), k).toMatchObject({ zoneOverride: true, reauth: 'PASSWORD' });
  });
});

describe('effect badges', () => {
  it('only the keys nothing applies yet are pending; every other key has a reader in the API', () => {
    // a key moves to ENFORCED in the same change that makes server.ts, worker.ts or a service read it
    expect(
      SETTINGS.filter((s) => s.effect.state !== 'ENFORCED')
        .map((s) => s.key)
        .sort(),
    ).toEqual([
      'delivery.autoAssign',
      'orders.cancellationRules',
      'orders.numberFormat',
      'orders.unpaidTimeoutMinutes',
      'sessions.remember',
      'sms.provider',
    ]);
  });
});

describe('onboarding document catalogue (D145)', () => {
  const ok = (v: unknown) => onboardingDocumentsSchema.safeParse(v).success;
  const base = DEFAULT_ONBOARDING_DOCUMENTS;

  it('a Super Admin type is accepted; OTHER, a bad code, a repeat and a short label are not', () => {
    const add = (d: unknown) => ({ ...base, HOTEL: [d] });
    expect(ok(add({ code: 'TRADE_LICENCE', label: 'Trade licence', mandatory: true }))).toBe(true);
    expect(ok(add({ code: 'OTHER', label: 'Other', mandatory: false }))).toBe(false);
    expect(ok(add({ code: 'trade', label: 'Trade', mandatory: false }))).toBe(false);
    expect(ok(add({ code: 'TRADE', label: 'T', mandatory: false }))).toBe(false);
    const d = { code: 'TRADE', label: 'Trade', mandatory: true };
    expect(ok({ ...base, HOTEL: [d, d] })).toBe(false);
    expect(ok({ ...base, CAFE: null })).toBe(false);
  });

  it('upgrades a value saved before D145', () => {
    const r = onboardingDocumentsSchema.parse({
      RESTAURANT: ['GST'],
      DELIVERY_PARTNER: [],
      HOME_FOOD: ['PAN'],
    });
    expect(r).toEqual({
      RESTAURANT: [{ code: 'GST', label: 'GST certificate', mandatory: true }],
      HOMEMAKER: [{ code: 'PAN', label: 'PAN card', mandatory: true }],
      DELIVERY_PARTNER: [],
      HOTEL: null,
    });
  });
});

describe('order, dispatch, payout, zone and session bounds', () => {
  it('unpaid timeout 5..120 minutes per prepaid method (D161)', () => {
    expect(orderUnpaidTimeoutSchema.safeParse({ ONLINE: 4, WALLET: 15 }).success).toBe(false);
    expect(orderUnpaidTimeoutSchema.safeParse({ ONLINE: 15, WALLET: 121 }).success).toBe(false);
    expect(orderUnpaidTimeoutSchema.safeParse({ ONLINE: 15, WALLET: 15, COD: 5 }).success).toBe(
      false,
    );
  });

  it('cancellation: admins at least as late as others, always with a reason (D156)', () => {
    const v = settingDef('orders.cancellationRules')?.default as Record<string, object>;
    expect(
      orderCancellationRulesSchema.safeParse({
        ...v,
        VENDOR: { allowedBefore: 'DELIVERED', reasonRequired: true },
      }).success,
    ).toBe(false);
    expect(
      orderCancellationRulesSchema.safeParse({
        ...v,
        ADMIN: { allowedBefore: 'OUT_FOR_DELIVERY', reasonRequired: false },
      }).success,
    ).toBe(false);
  });

  it('pre-orders: the lead time stays inside the horizon (D167)', () => {
    const v = settingDef('orders.preorder')?.default as Record<string, number>;
    expect(orderPreorderSchema.safeParse({ ...v, maxReschedules: 11 }).success).toBe(false);
    expect(
      orderPreorderSchema.safeParse({ ...v, minLeadMinutes: 1440, maxAheadDays: 1 }).success,
    ).toBe(false);
  });

  it('auto-assign radius 0.5..50 km in tenths, offer 15..600 s (D154)', () => {
    expect(
      deliveryAutoAssignSchema.safeParse({ enabled: true, radiusKm: 2.5, offerTimeoutSeconds: 30 })
        .success,
    ).toBe(true);
    expect(
      deliveryAutoAssignSchema.safeParse({ enabled: true, radiusKm: 0.2, offerTimeoutSeconds: 30 })
        .success,
    ).toBe(false);
    expect(
      deliveryAutoAssignSchema.safeParse({ enabled: true, radiusKm: 5, offerTimeoutSeconds: 5 })
        .success,
    ).toBe(false);
  });

  it('payout cycle 1..31 days (D152); cap never negative (D165); idle within the session (D163)', () => {
    expect(payoutCycleSchema.safeParse({ days: 0 }).success).toBe(false);
    expect(zoneDeliveryChargeCapSchema.safeParse({ capPaise: -1 }).success).toBe(false);
    expect(
      sessionRememberSchema.safeParse({ rememberDays: 1, rememberIdleHours: 25 }).success,
    ).toBe(false);
  });
});

describe('refund rules (D146, D180, D187)', () => {
  const def = settingDef('refunds.rules');
  const base = def?.default as Record<string, unknown>;
  const ok = (v: unknown) => def?.schema.safeParse(v).success;
  it('defaults: ten reasons with a bearer each, zone-overridable, PASSWORD', () => {
    expect(def).toMatchObject({ zoneOverride: true, reauth: 'PASSWORD' });
    expect((base['reasons'] as unknown[]).length).toBe(10);
    expect(ok(base)).toBe(true);
  });
  it('bounds: unique reason codes, non-empty targets of the method, decision time 15..10080', () => {
    const reasons = base['reasons'] as { code: string }[];
    expect(ok({ ...base, reasons: [...reasons, reasons[0]] })).toBe(false);
    expect(ok({ ...base, targets: { ONLINE: [], COD: ['WALLET'], WALLET: ['WALLET'] } })).toBe(
      false,
    );
    expect(ok({ ...base, targets: { ONLINE: ['UPI'], COD: ['WALLET'], WALLET: ['WALLET'] } })).toBe(
      false,
    );
    expect(ok({ ...base, decisionTimeLimitMinutes: 14 })).toBe(false);
    expect(ok({ ...base, cancellationWindowMinutes: 30 })).toBe(false);
  });
});
