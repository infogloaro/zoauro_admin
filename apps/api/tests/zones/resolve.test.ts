import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ZoneDto } from '@zoauro/shared';
import type { ResolveCaller, ZoneResolver } from '../../src/modules/zones';
import { ZoneResolver as Resolver } from '../../src/modules/zones/resolve.service';
import { ZonesRepository } from '../../src/modules/zones/zones.repository';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { contractValidator, readContractSchema } from './contract';
import { client, createZone, pins, reauth, type Signed } from './support';

// P12 (doc 56) / doc 53 section 2.3: zone resolution for the apps, on a throwaway database with the real Redis cache
// (zones:pin:<pincode>, keyed with zones:version, which the P11 writes bump). TC-ZONE-19, 20, 21 and the contract.
// The intake route (GET /zones/resolve, HMAC client, per-client rate limit) does not exist yet: tested at service level.

let env: AuthTestEnv;
let app: Express;
let resolver: ZoneResolver;
let sa: Signed;
const caller: ResolveCaller = { clientId: 'customer-app-test', scopes: ['zones:resolve'] };
const ZoneResolution = contractValidator('ZoneResolution');
const outputs: unknown[] = [];

async function resolve(input: { pincode?: string; lat?: number; lng?: number }) {
  const r = await resolver.resolve(caller, input);
  outputs.push(r);
  return r;
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  const built = env.makeAuthzApp();
  app = built.app;
  resolver = built.zones.resolver;
  const s = await env.session(await env.createUser('SUPER_ADMIN'));
  sa = { cookie: s.cookie, csrf: s.csrf };
  await reauth(env, sa);
}, 180_000);
afterAll(async () => {
  await env.close();
});

const impactVersion = async (id: string) =>
  (await client(sa, app).get(`/zones/${id}/impact`)).body.impactVersion as string;

describe('TC-ZONE-20: pincode in ACTIVE / UPCOMING / INACTIVE / unknown / invalid', () => {
  it('ACTIVE is serviceable with the charge; UPCOMING is "coming soon"; INACTIVE, unknown and invalid are NONE', async () => {
    const [pa, pu, pi] = pins(3);
    const active = await createZone(sa, app, {
      pincodes: [pa],
      status: 'ACTIVE',
      deliveryChargePaise: 3500,
    });
    const upcoming = await createZone(sa, app, { pincodes: [pu] });
    const closed = await createZone(sa, app, { pincodes: [pi], status: 'ACTIVE' });
    const off = await client(sa, app).post(`/zones/${closed.id}/deactivate`, {
      version: closed.version,
      impactVersion: await impactVersion(closed.id),
      reason: 'Closed for the monsoon',
    });
    expect(off.status).toBe(200);

    expect(await resolve({ pincode: pa })).toEqual({
      serviceable: true,
      zoneId: active.id,
      zoneName: active.name,
      status: 'ACTIVE',
      deliveryChargePaise: 3500,
    });
    expect(await resolve({ pincode: ` ${pa} ` })).toMatchObject({ serviceable: true }); // trimmed
    expect(await resolve({ pincode: pu })).toEqual({
      serviceable: false,
      zoneId: upcoming.id,
      zoneName: upcoming.name,
      status: 'UPCOMING',
    });
    // a closed zone is not disclosed (D87): no id, no name
    expect(await resolve({ pincode: pi })).toEqual({ serviceable: false, status: 'NONE' });
    expect(await resolve({ pincode: pins(1)[0] })).toEqual({ serviceable: false, status: 'NONE' });
    for (const bad of ['012345', '56001', 'abcdef', '5600011', ''])
      expect(await resolve({ pincode: bad })).toEqual({ serviceable: false, status: 'NONE' });
  });

  it('a deleted zone resolves to NONE', async () => {
    const [p] = pins(1);
    const z = await createZone(sa, app, { pincodes: [p] });
    expect((await resolve({ pincode: p })).status).toBe('UPCOMING');
    expect((await client(sa, app).delete(`/zones/${z.id}`)).status).toBe(204);
    expect(await resolve({ pincode: p })).toEqual({ serviceable: false, status: 'NONE' });
  });
});

describe('TC-ZONE-19: a change is visible to the very next resolve', () => {
  it('charge change, deactivation, reactivation and pincode removal each invalidate the warm cache', async () => {
    const [p] = pins(1);
    let z: ZoneDto = await createZone(sa, app, {
      pincodes: [p],
      status: 'ACTIVE',
      deliveryChargePaise: 2000,
    });
    expect(await resolve({ pincode: p })).toMatchObject({ deliveryChargePaise: 2000 });

    // warm: the second answer comes from Redis, not the database
    const db = vi.spyOn(ZonesRepository.prototype, 'resolvePincode');
    expect(await resolve({ pincode: p })).toMatchObject({ deliveryChargePaise: 2000 });
    expect(db).not.toHaveBeenCalled();

    const patched = await client(sa, app).patch(`/zones/${z.id}`, {
      version: z.version,
      deliveryChargePaise: 4500,
    });
    expect(patched.status).toBe(200);
    z = patched.body as ZoneDto;
    expect(await resolve({ pincode: p })).toMatchObject({ deliveryChargePaise: 4500 });
    expect(db).toHaveBeenCalledTimes(1);
    db.mockRestore();

    const off = await client(sa, app).post(`/zones/${z.id}/deactivate`, {
      version: z.version,
      impactVersion: await impactVersion(z.id),
      reason: 'Temporarily closed for repairs',
    });
    expect(await resolve({ pincode: p })).toEqual({ serviceable: false, status: 'NONE' });
    const on = await client(sa, app).post(`/zones/${z.id}/activate`, { version: off.body.version });
    expect(on.status).toBe(200);
    expect(await resolve({ pincode: p })).toMatchObject({
      serviceable: true,
      deliveryChargePaise: 4500,
    });

    await client(sa, app).put(`/zones/${z.id}/pincodes`, { remove: [p] });
    expect(await resolve({ pincode: p })).toEqual({ serviceable: false, status: 'NONE' });
  });

  it('when Redis fails the answer still comes from the database', async () => {
    const [p] = pins(1);
    const z = await createZone(sa, app, { pincodes: [p], status: 'ACTIVE' });
    const errors: string[] = [];
    const broken = new Resolver({
      repo: () => new ZonesRepository(env.prisma),
      cache: {
        read: async () => {
          throw new Error('redis down');
        },
        write: async () => {
          throw new Error('redis down');
        },
      },
      onCacheError: (e) => errors.push(e instanceof Error ? e.message : 'x'),
    });
    expect(await broken.resolve(caller, { pincode: p })).toMatchObject({ zoneId: z.id });
    expect(errors).toEqual(['redis down']); // read failed; nothing written without a version
  });
});

describe('TC-ZONE-21: coordinates only, scope', () => {
  it('lat/lng without a pincode is NONE (pincode only in v1, D83); lat/lng never change a pincode answer', async () => {
    const [p] = pins(1);
    await createZone(sa, app, { pincodes: [p], status: 'ACTIVE' });
    expect(await resolve({ lat: 13.0827, lng: 80.2707 })).toEqual({
      serviceable: false,
      status: 'NONE',
    });
    expect(await resolve({ pincode: p, lat: 0, lng: 0 })).toMatchObject({ serviceable: true });
  });

  it('a client without zones:resolve is refused (403) and nothing is read', async () => {
    const db = vi.spyOn(ZonesRepository.prototype, 'resolvePincode');
    await expect(
      resolver.resolve(
        { clientId: 'vendor-app', scopes: ['vendors:write'] },
        { pincode: '600001' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(db).not.toHaveBeenCalled();
    db.mockRestore();
    // the repository refuses on its own too
    expect(
      await new ZonesRepository(env.prisma).resolvePincode({ clientId: 'x', scopes: [] }, '600001'),
    ).toBeNull();
  });

  it.todo(
    'rate limit 429 per API client: the intake module registers GET /zones/resolve with it (IH-2)',
  );
});

describe('contract: every answer is a ZoneResolution (contracts/intake.openapi.yaml)', () => {
  it('the contract schema is read as the file states it', () => {
    expect(readContractSchema('ZoneResolution')).toEqual({
      properties: {
        serviceable: { type: 'boolean' },
        zoneId: { type: 'string' },
        zoneName: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'UPCOMING', 'INACTIVE', 'NONE'] },
        deliveryChargePaise: { type: 'integer' },
      },
      required: [],
    });
  });

  it('all outputs of this file validate strictly; null or extra fields would not', () => {
    expect(outputs.length).toBeGreaterThan(15);
    for (const o of outputs)
      expect(ZoneResolution.safeParse(o).success, JSON.stringify(o)).toBe(true);
    expect(
      ZoneResolution.safeParse({
        serviceable: false,
        status: 'UPCOMING',
        deliveryChargePaise: null,
      }).success,
    ).toBe(false);
    expect(
      ZoneResolution.safeParse({ serviceable: false, status: 'NONE', reason: 'x' }).success,
    ).toBe(false);
  });
});
