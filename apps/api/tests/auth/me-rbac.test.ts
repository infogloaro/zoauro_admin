import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from './support/auth-env';

// P6 (doc 56) / doc 09 /me, doc 14 section 4, doc 04: what /me says a member may do, per zone, comes from the access
// tables on every request (profile + GRANT − DENY, deny wins; limits from the assignment or the profile defaults).

let env: AuthTestEnv;
let superAdminId: string;
beforeAll(async () => {
  env = await createAuthTestEnv();
  superAdminId = (await env.createUser('SUPER_ADMIN')).id;
}, 120_000);
afterAll(async () => {
  await env.close();
});

type MeZone = {
  zoneId: string;
  name: string;
  code: string;
  colorHex: string;
  status: string;
  permissions: string[];
  limits: { perRefund: number; dailyRefund: number; canReveal: boolean; canExport: boolean };
};

async function meZones(user: Awaited<ReturnType<AuthTestEnv['createUser']>>) {
  const { cookie } = await env.session(user);
  const res = await env.api().get('/me').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return { body: res.body, zones: res.body.permissions.zones as MeZone[], cookie };
}

describe('GET /me for a Zonal Admin: zones with permissions and limits', () => {
  it('Admin(A+B): full orders in A; read-only in B; each zone with its own profile and limits', async () => {
    const full = await env.createProfile(
      { orders: ['view', 'add', 'edit', 'status'], restaurants: ['view'] },
      { perRefund: 50_000, dailyRefund: 200_000, canReveal: true, canExport: false },
    );
    const readOnly = await env.createProfile({ orders: ['view'] });
    const zoneA = await env.createZone();
    const zoneB = await env.createZone();
    const member = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(member.id, zoneA, superAdminId, { profileId: full });
    await env.assignZone(member.id, zoneB, superAdminId, { profileId: readOnly });

    const { zones } = await meZones(member);
    const a = zones.find((z) => z.zoneId === zoneA);
    const b = zones.find((z) => z.zoneId === zoneB);
    expect(zones).toHaveLength(2);
    expect(a).toMatchObject({
      status: 'ACTIVE',
      colorHex: '#2563EB',
      permissions: [
        'orders:add',
        'orders:edit',
        'orders:status',
        'orders:view',
        'restaurants:view',
      ],
      limits: { perRefund: 50_000, dailyRefund: 200_000, canReveal: true, canExport: false },
    });
    expect(a?.code).toMatch(/^Z[0-9A-F]{5}$/);
    expect(b?.permissions).toEqual(['orders:view']);
    expect(b?.limits).toEqual({ perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false });
  });

  it('a DENY override removes a profile permission (deny wins over the profile), a GRANT adds one', async () => {
    const profile = await env.createProfile({ orders: ['view', 'edit'], payments: ['view'] });
    const zone = await env.createZone();
    const member = await env.createUser('ZONAL_ADMIN');
    const assignment = await env.assignZone(member.id, zone, superAdminId, { profileId: profile });
    await env.addOverride(assignment, 'payments', 'view', 'DENY');
    await env.addOverride(assignment, 'restaurants', 'view', 'GRANT');
    await env.addOverride(assignment, 'orders', 'edit', 'DENY');
    // one override per assignment, module and action (primary key), so GRANT and DENY of one key cannot coexist

    const { zones } = await meZones(member);
    expect(zones[0]?.permissions).toEqual(['orders:view', 'restaurants:view']);
  });

  it('never lists permissions a Zonal Admin may not hold, even if a profile row says so (zones, access, settings)', async () => {
    const profile = await env.createProfile({
      orders: ['view'],
      zones: ['view', 'edit'],
      settings: ['view'],
    });
    const zone = await env.createZone();
    const member = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(member.id, zone, superAdminId, { profileId: profile });
    const { zones } = await meZones(member);
    expect(zones[0]?.permissions).toEqual(['orders:view']);
  });

  it('a revoked assignment disappears as soon as the access cache is invalidated; Admin(none) has no zones', async () => {
    const { app, access } = env.makeAuthzApp();
    const profile = await env.createProfile({ orders: ['view'] });
    const zone = await env.createZone();
    const member = await env.createUser('ZONAL_ADMIN');
    const assignment = await env.assignZone(member.id, zone, superAdminId, { profileId: profile });
    const { cookie } = await env.session(member);
    const before = await env.api(app).get('/me').set('Cookie', cookie);
    expect(before.body.permissions.zones).toHaveLength(1);

    // what M03 does on every access change (doc 14 section 4): write, then invalidate the member's cached context
    await env.db.owner.query(`UPDATE admin_zone_assignments SET revoked_at = now() WHERE id = $1`, [
      assignment,
    ]);
    await access.invalidateUsers([member.id]);
    const res = await env.api(app).get('/me').set('Cookie', cookie);
    expect(res.body.permissions).toEqual({ global: false, zones: [] });

    const nobody = await env.createUser('ZONAL_ADMIN');
    expect((await meZones(nobody)).body.permissions).toEqual({ global: false, zones: [] });
  });

  it('an inactive zone stays listed with its status (open work can be finished, doc 53 section 2.1)', async () => {
    const profile = await env.createProfile({ orders: ['view'] });
    const zone = await env.createZone();
    await env.db.owner.query(`UPDATE zones SET status = 'INACTIVE' WHERE id = $1`, [zone]);
    const member = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(member.id, zone, superAdminId, { profileId: profile });
    expect((await meZones(member)).zones[0]?.status).toBe('INACTIVE');
  });
});

describe('GET /me for every role', () => {
  it('Super Admin is global; mfa reports the enrolled method and the policy (doc 52 section 8)', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(sa);
    const body = (await env.api().get('/me').set('Cookie', cookie)).body;
    expect(body.permissions).toEqual({ global: true });
    expect(body.mfa).toEqual({ enabled: true, required: true, enrolmentNeeded: false });
  });
});
