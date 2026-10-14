import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { client, outboxRows, reauth, zoneAuditRows, type Signed } from './support';

// D92 per-zone service switches (owner, 2026-10-14): Super Admin only, PASSWORD re-auth, audited, internal event only,
// defaults Restaurants + Home Food on and Hotel Booking off, and the gate the order/onboarding modules will call.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let zone: string;
const api = () => client(sa, app);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  const s = await env.session(superAdmin);
  sa = { cookie: s.cookie, csrf: s.csrf };
  zone = await env.createZone();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('zone services (D92)', () => {
  it('defaults: Restaurants and Home Food on, Hotel Booking off, marked as defaults', async () => {
    const r = await api().get(`/zones/${zone}/services`);
    expect(r.status).toBe(200);
    expect(
      r.body.services.map((s: { service: string; enabled: boolean; isDefault: boolean }) => [
        s.service,
        s.enabled,
        s.isDefault,
      ]),
    ).toEqual([
      ['RESTAURANTS', true, true],
      ['HOME_FOOD', true, true],
      ['HOTEL_BOOKING', false, true],
    ]);
    const detail = await api().get(`/zones/${zone}`);
    expect(detail.body.services).toEqual({
      RESTAURANTS: true,
      HOME_FOOD: true,
      HOTEL_BOOKING: false,
    });
  });

  it('a switch needs PASSWORD re-authentication; it is audited once, sends only the internal event, and repeats are no-ops', async () => {
    env.clock.advance(11 * 60_000); // no earlier step-up is still valid
    const denied = await api().put(`/zones/${zone}/services`, { services: { HOME_FOOD: false } });
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('REAUTH_REQUIRED');

    await reauth(env, sa);
    const r = await api().put(`/zones/${zone}/services`, {
      services: { HOME_FOOD: false, RESTAURANTS: true },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const homeFood = r.body.services.find((s: { service: string }) => s.service === 'HOME_FOOD');
    expect(homeFood).toMatchObject({ enabled: false, isDefault: false });
    expect(homeFood.updatedBy).not.toBeNull();

    const audits = (await zoneAuditRows(env, zone)).filter(
      (a) => a.action === 'zone.services_changed',
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      sensitivity: 'HIGH',
      // the audit diff keeps only what changed
      before_json: { HOME_FOOD: true },
      after_json: { HOME_FOOD: false },
    });
    const events = await outboxRows(env, zone);
    expect(events.filter((e) => e.event_type === 'zone.updated')).toHaveLength(0); // the apps are not told yet
    expect(
      events
        .filter((e) => e.event_type === 'admin.zones_changed')
        .map((e) => (e.payload_json['data'] as { change: string }).change),
    ).toContain('services_changed');

    // the same value again: nothing written
    await reauth(env, sa);
    expect(
      (await api().put(`/zones/${zone}/services`, { services: { HOME_FOOD: false } })).status,
    ).toBe(200);
    expect(
      (await zoneAuditRows(env, zone)).filter((a) => a.action === 'zone.services_changed'),
    ).toHaveLength(1);

    const list = await api().get('/zones?limit=100');
    expect(list.body.data.find((z: { id: string }) => z.id === zone).services.HOME_FOOD).toBe(
      false,
    );
  });

  it('an empty or unknown switch is 422', async () => {
    await reauth(env, sa);
    expect((await api().put(`/zones/${zone}/services`, { services: {} })).status).toBe(422);
    await reauth(env, sa);
    expect(
      (await api().put(`/zones/${zone}/services`, { services: { GROCERY: true } })).status,
    ).toBe(422);
  });

  it("a Zonal Admin's /me carries the services of each of their zones, and they cannot switch them", async () => {
    const member = await env.createUser('ZONAL_ADMIN');
    const other = await env.createUser('SUPER_ADMIN');
    await env.assignZone(member.id, zone, other.id);
    const s = await env.session(member);
    const me = await client({ cookie: s.cookie, csrf: s.csrf }, app).get('/me');
    expect(me.body.permissions.zones[0].services).toEqual({
      RESTAURANTS: true,
      HOME_FOOD: false,
      HOTEL_BOOKING: false,
    });
    const put = await client({ cookie: s.cookie, csrf: s.csrf }, app).put(
      `/zones/${zone}/services`,
      {
        services: { HOME_FOOD: true },
      },
    );
    expect(put.status).toBe(403);
  });

  it('the gate for orders and onboarding: off is 409 ZONE_SERVICE_DISABLED, on passes, an unknown zone is 404', async () => {
    const zones = env.makeAuthzApp().zones.service;
    await expect(zones.assertServiceEnabled(zone, 'RESTAURANTS')).resolves.toBeUndefined();
    await expect(zones.assertServiceEnabled(zone, 'HOME_FOOD')).rejects.toMatchObject({
      code: 'ZONE_SERVICE_DISABLED',
      meta: { service: 'HOME_FOOD' },
    });
    // never switched: the default (off) applies
    await expect(zones.assertServiceEnabled(zone, 'HOTEL_BOOKING')).rejects.toMatchObject({
      code: 'ZONE_SERVICE_DISABLED',
    });
    await expect(
      zones.assertServiceEnabled('0192f1d2-0000-7000-8000-00000000dead', 'RESTAURANTS'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
