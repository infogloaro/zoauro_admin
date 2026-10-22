import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// GET /me/badges: the menu's waiting counts in one call, each equal to what its own list reports for the same member
// (scope included); access requests only for a Super Admin; a member without a module sees its count as null or 0 as
// that list would.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let zonal: Signed;
let none: Signed;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  const zone = await env.createZone();
  const profile = await env.createProfile({ menu: ['view'], delivery: ['view'] });
  const z = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'bd-z' });
  await env.assignZone(z.id, zone, superAdmin.id, { profileId: profile });
  zonal = await signIn(z);
  none = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'bd-n' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /me/badges', () => {
  it('each count equals its own list for the same member; access requests are the Super Admin’s', async () => {
    for (const [s, isSa] of [
      [sa, true],
      [zonal, false],
    ] as const) {
      const r = await client(s, app).get('/me/badges');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const food = await client(s, app).get(
        '/menu-items/change-requests?page=1&pageSize=1&status=PENDING',
      );
      const partners = await client(s, app).get('/delivery-partners?page=1&pageSize=1');
      const mine = await client(s, app).get('/claims/mine');
      expect(r.body.foodRequests).toBe(food.body.meta.total);
      expect(r.body.partnerRequests).toBe(partners.body.meta.counts.pendingVerification);
      expect(r.body.myClaims).toBe(mine.body.data.length);
      if (isSa) {
        const access = await client(s, app).get('/access-requests?status=PENDING&limit=1');
        expect(r.body.accessRequests).toBe(access.body.meta.pendingCount);
      } else expect(r.body.accessRequests).toBeNull();
    }
    const n = await client(none, app).get('/me/badges');
    expect(n.status).toBe(200);
    expect(n.body).toMatchObject({ accessRequests: null, myClaims: 0 });
    expect((await client(null, app).get('/me/badges')).status).toBe(401);
  });
});
