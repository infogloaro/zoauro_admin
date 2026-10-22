import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  createAuthTestEnv,
  PASSWORD,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// Platform settings (doc 59 §2–5, owner decisions D109–D116) against a real database: default -> platform -> zone,
// effect states, re-auth per key (D112), validation, versions, reset, history with the reason, preview, and the refund
// caps of D110 (refused above the cap on save, clamped on every request).

let env: AuthTestEnv;
let app: Express;
let superAdmin: TestUser;
let sa: Signed;
let zone: string;
let otherZone: string;
const api = () => client(sa, app);
const REASON = 'Agreed with operations';

/** STRONG step-up: password + the current authenticator code (doc 52 section 2.4). */
async function strong(): Promise<void> {
  await env.db.owner.query(`UPDATE user_mfa_methods SET last_used_step = NULL WHERE user_id = $1`, [
    superAdmin.id,
  ]);
  const r = await api().post('/auth/reauth', {
    password: PASSWORD,
    method: 'AUTHENTICATOR',
    code: await totpAt(superAdmin.totpSecret ?? '', env.clock.now()),
  });
  expect(r.status).toBe(200);
}
const expireReauth = () => env.clock.advance(11 * 60_000);
type Row = {
  key: string;
  source: string;
  effective: unknown;
  effect: { state: string };
  platform: { version: number } | null;
};
const byKey = (body: { data: Row[] }, key: string) => body.data.find((s) => s.key === key);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  superAdmin = await env.createUser('SUPER_ADMIN');
  const s = await env.session(superAdmin);
  sa = { cookie: s.cookie, csrf: s.csrf };
  zone = await env.createZone();
  otherZone = await env.createZone();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('registry and the default rule (D109)', () => {
  it('every key starts on its decided default, with its source and effect state', async () => {
    const r = await api().get('/settings');
    expect(r.status).toBe(200);
    const limits = byKey(r.body, 'refunds.limits');
    expect(limits).toMatchObject({
      source: 'DEFAULT',
      platform: null,
      effective: {
        perRefundPaise: 100_000,
        perDayPaise: 500_000,
        secondApproverAbovePaise: 1_000_000,
      },
      effect: { state: 'ENFORCED' },
      reauth: 'STRONG',
      zoneOverride: true,
    });
    // D146/D180/D187: refund rules have decided defaults now
    expect(byKey(r.body, 'refunds.rules')).toMatchObject({
      source: 'DEFAULT',
      effect: { state: 'PENDING_MODULE' },
      effective: { decisionTimeLimitMinutes: 240, targets: { COD: ['WALLET', 'UPI'] } },
    });
    expect(byKey(r.body, 'loyalty.values')?.effect.state).toBe('NOT_CONFIGURED');
    expect(byKey(r.body, 'support.sla')?.effect).toMatchObject({
      state: 'PENDING_MODULE',
      module: 'Support desk',
    });
    expect(byKey(r.body, 'onboarding.documents')?.effective).toMatchObject({ HOTEL: null }); // D145
    expect(
      (byKey(r.body, 'onboarding.documents')?.effective as { HOMEMAKER: { code: string }[] })
        .HOMEMAKER[0],
    ).toMatchObject({ code: 'FSSAI_REGISTRATION', mandatory: true });
    for (const k of [
      'orders.unpaidTimeoutMinutes',
      'orders.cancellationRules',
      'orders.preorder',
      'delivery.autoAssign',
      'payouts.cycleDays',
      'zones.deliveryChargeCapPaise',
      'access.commissionEditGrantable',
      'sessions.remember',
    ])
      expect(byKey(r.body, k)?.source, k).toBe('DEFAULT');
    expect(byKey(r.body, 'security.mfa')).toMatchObject({
      editable: false,
      effect: { state: 'ENFORCED' },
    });
  });
});

describe('saving, versions, reset and history', () => {
  it('a business setting needs PASSWORD; it is saved with a reason, versioned, and shows in the history', async () => {
    expireReauth();
    const body = {
      values: { 'notifications.timing': { promotionalFrom: '10:00', promotionalTo: '20:00' } },
      reason: REASON,
    };
    const denied = await api().put('/settings/notifications', body);
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('REAUTH_REQUIRED');

    await reauth(env, sa);
    const r = await api().put('/settings/notifications', body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(byKey(r.body, 'notifications.timing')).toMatchObject({
      source: 'PLATFORM',
      effective: { promotionalFrom: '10:00', promotionalTo: '20:00' },
      platform: { version: 1 },
    });

    const history = await api().get('/settings/history?key=notifications.timing');
    expect(history.body.data[0]).toMatchObject({
      action: 'settings.updated',
      key: 'notifications.timing',
      reason: REASON,
      actor: { id: superAdmin.id },
    });

    // the same value again writes nothing
    await reauth(env, sa);
    await api().put('/settings/notifications', body);
    expect((await api().get('/settings/history?key=notifications.timing')).body.data).toHaveLength(
      1,
    );

    // a stale version is refused with the current one
    await reauth(env, sa);
    const stale = await api().put('/settings/notifications', {
      values: { 'notifications.timing': { promotionalFrom: '08:00', promotionalTo: '20:00' } },
      reason: REASON,
      versions: { 'notifications.timing': 0 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'STALE_VERSION',
      meta: { current: { version: 1 } },
    });

    // reset: back to the default rule, audited
    await reauth(env, sa);
    const reset = await api()
      .delete('/settings/notifications/notifications.timing')
      .send({ reason: REASON });
    expect(reset.status).toBe(200);
    expect(byKey(reset.body, 'notifications.timing')).toMatchObject({
      source: 'DEFAULT',
      effective: { promotionalFrom: '09:00', promotionalTo: '21:00' },
    });
    expect(
      (await api().get('/settings/history?key=notifications.timing')).body.data[0].action,
    ).toBe('settings.reset');
  });

  it('the history of a group lists every key of the group, whatever its prefix (orders holds delivery.*)', async () => {
    await reauth(env, sa);
    const r = await api().put('/settings/orders', {
      values: { 'delivery.maxConcurrentOrders': { perPartner: 2 } },
      reason: REASON,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const history = await api().get('/settings/history?group=orders');
    expect(history.body.data.map((h: { key: string }) => h.key)).toContain(
      'delivery.maxConcurrentOrders',
    );
    const other = await api().get('/settings/history?group=notifications');
    expect(other.body.data.map((h: { key: string }) => h.key)).not.toContain(
      'delivery.maxConcurrentOrders',
    );
  });

  it('D112: refund limits and the SMS provider need STRONG; a password alone is refused', async () => {
    await reauth(env, sa);
    const body = {
      values: {
        'refunds.limits': {
          perRefundPaise: 80_000,
          perDayPaise: 400_000,
          secondApproverAbovePaise: 1_000_000,
        },
      },
      reason: REASON,
    };
    expect((await api().put('/settings/refunds', body)).status).toBe(401);
    await strong();
    const r = await api().put('/settings/refunds', body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(byKey(r.body, 'refunds.limits')?.source).toBe('PLATFORM');
  });

  it('refuses unknown, non-editable and invalid values with one detail each', async () => {
    await reauth(env, sa);
    const r = await api().put('/settings/notifications', {
      values: {
        'notifications.channels': { inApp: true, email: true, sms: true, whatsapp: true },
        'support.sla': {},
        'notifications.nope': 1,
      },
      reason: REASON,
    });
    expect(r.status).toBe(422);
    const issues = (r.body.error.details as { field: string; issue: string }[]).map(
      (d) => `${d.field}:${d.issue}`,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'values.notifications.channels.whatsapp:no WhatsApp provider is set up yet',
        'values.support.sla:UNKNOWN_SETTING', // not in this group
        'values.notifications.nope:UNKNOWN_SETTING',
      ]),
    );
    await reauth(env, sa);
    const sms = await api().put('/settings/notifications', {
      values: {
        'notifications.channels': { inApp: true, email: true, sms: true, whatsapp: false },
      },
      reason: REASON,
    });
    expect(sms.body.error.details).toEqual([
      { field: 'values.notifications.channels.sms', issue: 'SMS_NOT_AVAILABLE' },
    ]);
    await reauth(env, sa);
    const short = await api().put('/settings/support', {
      values: {
        'support.sla': {
          firstResponseMinutes: 60,
          resolutionMinutes: 600,
          escalationMinutes: 300,
          reopenWithinDays: 7,
          assignment: 'ROUND_ROBIN',
        },
      },
      reason: 'ok',
    });
    expect(short.status).toBe(422); // the reason is mandatory (at least 5 characters)
  });
});

describe('zone overrides (D109)', () => {
  it('only zone-overridable keys; the zone value wins in that zone only; removing it falls back', async () => {
    await reauth(env, sa);
    const bad = await api().put(`/zones/${zone}/settings/onboarding`, {
      values: {
        'onboarding.documents': { RESTAURANT: ['FSSAI'], DELIVERY_PARTNER: [], HOME_FOOD: null },
      },
      reason: REASON,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual([
      { field: 'values.onboarding.documents', issue: 'NO_ZONE_OVERRIDE' },
    ]);

    await reauth(env, sa);
    const sla = {
      firstResponseMinutes: 30,
      resolutionMinutes: 600,
      escalationMinutes: 300,
      reopenWithinDays: 3,
      assignment: 'LEAST_BUSY',
    };
    const r = await api().put(`/zones/${zone}/settings/support`, {
      values: { 'support.sla': sla },
      reason: REASON,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(byKey(r.body, 'support.sla')).toMatchObject({ source: 'ZONE', effective: sla });
    const other = await api().get(`/settings/support?zoneId=${otherZone}`);
    expect(byKey(other.body, 'support.sla')?.source).toBe('DEFAULT');

    await reauth(env, sa);
    const removed = await api()
      .delete(`/zones/${zone}/settings/support/support.sla`)
      .send({ reason: REASON });
    expect(byKey(removed.body, 'support.sla')?.source).toBe('DEFAULT');
    const history = await api().get(`/settings/history?zoneId=${zone}`);
    expect(history.body.data.map((h: { action: string }) => h.action)).toEqual([
      'settings.zone_override_removed',
      'settings.zone_override_set',
    ]);
  });
});

describe('refund caps (D110)', () => {
  it('a member limit above the zone cap is refused; preview lists who a lower cap clamps; /me is clamped', async () => {
    // the platform cap from the D112 test: 80,000 / 400,000 paise
    const member = await env.createUser('ZONAL_ADMIN');
    const profile = (await env.db.owner.query(`SELECT id FROM access_profiles LIMIT 1`)).rows[0]
      .id as string;
    await reauth(env, sa);
    const above = await api().put(`/zonal-admins/${member.id}/access`, {
      assignments: [
        {
          zoneId: zone,
          profileId: profile,
          limits: { perRefund: 90_000, dailyRefund: null, canReveal: null, canExport: null },
        },
      ],
    });
    expect(above.status).toBe(422);
    expect(above.body.error.details).toEqual([
      { field: 'assignments.0.limits.perRefund', issue: 'ABOVE_ZONE_CAP' },
    ]);

    await reauth(env, sa);
    const ok = await api().put(`/zonal-admins/${member.id}/access`, {
      assignments: [
        {
          zoneId: zone,
          profileId: profile,
          limits: { perRefund: 60_000, dailyRefund: 300_000, canReveal: null, canExport: null },
        },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const lower = {
      'refunds.limits': {
        perRefundPaise: 50_000,
        perDayPaise: 200_000,
        secondApproverAbovePaise: 1_000_000,
      },
    };
    const preview = await api().post(`/settings/refunds/preview`, { values: lower, zoneId: zone });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.membersAboveCap).toEqual([
      expect.objectContaining({
        memberId: member.id,
        zoneId: zone,
        perRefundPaise: 60_000,
        dailyRefundPaise: 300_000,
      }),
    ]);

    await strong();
    expect(
      (await api().put(`/zones/${zone}/settings/refunds`, { values: lower, reason: REASON }))
        .status,
    ).toBe(200);
    const s = await env.session(member);
    const me = await client({ cookie: s.cookie, csrf: s.csrf }, app).get('/me');
    expect(me.body.permissions.zones[0].limits).toMatchObject({
      perRefund: 50_000,
      dailyRefund: 200_000,
    });
  });

  it('the order number preview shows the format with the zone code', async () => {
    const r = await api().post('/settings/orders/preview', {
      values: { 'orders.numberFormat': { template: 'ZO-{ZONE}-{YYYY}-{SEQ}' } },
      zoneId: zone,
    });
    expect(r.status).toBe(200);
    expect(r.body.orderNumberExample).toMatch(/^ZO-Z[0-9A-F]+-\d{4}-000001$/);
    const bad = await api().post('/settings/orders/preview', {
      values: { 'orders.numberFormat': { template: 'ZO-{ZONE}' } },
    });
    expect(bad.status).toBe(422);
  });
});

describe('a Zonal Admin can never reach settings', () => {
  it('403 on read, preview and write', async () => {
    const member = await env.createUser('ZONAL_ADMIN');
    const s = await env.session(member);
    const c = client({ cookie: s.cookie, csrf: s.csrf }, app);
    for (const res of [
      await c.get('/settings'),
      await c.get('/settings/history'),
      await c.post('/settings/refunds/preview', { values: { 'refunds.limits': {} } }),
      await c.put('/settings/support', { values: {}, reason: REASON }),
    ])
      expect(res.status).toBe(403);
  });
});
