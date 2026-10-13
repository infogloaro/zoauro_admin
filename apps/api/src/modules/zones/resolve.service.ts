import { normalisePincode } from '@zoauro/shared';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors';
import { RESOLVE_SCOPE, type ResolveCaller } from './resolve.caller';
import { ZONES_VERSION_KEY } from './zones.events';
import type { ZonesRepository } from './zones.repository';

// Zone resolution for the customer, vendor and partner apps (doc 53 section 2.3, contract ZoneResolution in
// docs/G-integration/contracts/intake.openapi.yaml, served later as GET /zones/resolve by the intake module).
//
//  1. normalise the pincode (trim, ^[1-9][0-9]{5}$), otherwise NONE
//  2. look it up in serviceable_pincodes (unique) -> its zone, if not deleted
//  3. ACTIVE   -> serviceable, zone id and name, deliveryChargePaise
//     UPCOMING -> not serviceable, zone id and name, status UPCOMING ("coming soon")
//     INACTIVE -> NONE: an app never learns about closed zones (D87)
//     no match -> NONE
//
// lat/lng are accepted and NOT used (D83): there is no zone geometry in v1, so serviceability is decided by pincode only.
// An app that has only coordinates gets NONE and must reverse-geocode to a pincode first (doc 42 §3 note).
//
// The contract types deliveryChargePaise as a plain integer, so it is omitted (not null, as doc 53 writes) when a zone
// is not serviceable (doc 32).

export type ZoneResolution =
  | {
      serviceable: true;
      zoneId: string;
      zoneName: string;
      status: 'ACTIVE';
      deliveryChargePaise: number;
    }
  | { serviceable: false; zoneId: string; zoneName: string; status: 'UPCOMING' }
  | { serviceable: false; status: 'NONE' };

export interface ResolveInput {
  pincode?: string | undefined;
  /** accepted, not used (D83) */
  lat?: number | undefined;
  /** accepted, not used (D83) */
  lng?: number | undefined;
}

const NONE: ZoneResolution = { serviceable: false, status: 'NONE' };
export const RESOLVE_CACHE_TTL_SEC = 300;
export const resolveCacheKey = (pincode: string): string => `zones:pin:${pincode}`;

/** The two Redis calls the resolver makes; a failure of either falls back to the database. */
export interface ResolveCache {
  /** [zones:version, zones:pin:<pincode>] in one round trip */
  read(pincode: string): Promise<{ version: string; entry: string | null }>;
  write(pincode: string, entry: string): Promise<void>;
}

export function redisResolveCache(redis: Redis): ResolveCache {
  return {
    read: async (pincode) => {
      const [version, entry] = await redis.mget(ZONES_VERSION_KEY, resolveCacheKey(pincode));
      return { version: version ?? '0', entry: entry ?? null };
    },
    write: async (pincode, entry) => {
      await redis.set(resolveCacheKey(pincode), entry, 'EX', RESOLVE_CACHE_TTL_SEC);
    },
  };
}

interface CacheEntry {
  /** zones:version the answer was computed under; any zone or pincode change bumps it (P11) */
  v: string;
  r: ZoneResolution;
}

export class ZoneResolver {
  constructor(
    private readonly deps: {
      repo: () => ZonesRepository;
      cache: ResolveCache;
      /** class name only is logged (doc 13) */
      onCacheError?: (err: unknown) => void;
    },
  ) {}

  async resolve(caller: ResolveCaller, input: ResolveInput): Promise<ZoneResolution> {
    if (!caller.scopes.includes(RESOLVE_SCOPE))
      throw new AppError('FORBIDDEN', 'This client may not resolve zones');
    // input.lat / input.lng intentionally ignored: pincode only in v1 (D83)
    const pincode = input.pincode === undefined ? null : normalisePincode(input.pincode);
    if (pincode === null) return NONE;

    let version: string | null = null;
    try {
      const hit = await this.deps.cache.read(pincode);
      version = hit.version;
      if (hit.entry) {
        const entry = JSON.parse(hit.entry) as CacheEntry;
        if (entry.v === version) return entry.r;
      }
    } catch (err) {
      this.deps.onCacheError?.(err);
    }

    const zone = await this.deps.repo().resolvePincode(caller, pincode);
    const result: ZoneResolution =
      zone?.status === 'ACTIVE'
        ? {
            serviceable: true,
            zoneId: zone.id,
            zoneName: zone.name,
            status: 'ACTIVE',
            deliveryChargePaise: zone.deliveryCharge,
          }
        : zone?.status === 'UPCOMING'
          ? { serviceable: false, zoneId: zone.id, zoneName: zone.name, status: 'UPCOMING' }
          : NONE;

    if (version !== null) {
      try {
        await this.deps.cache.write(pincode, JSON.stringify({ v: version, r: result }));
      } catch (err) {
        this.deps.onCacheError?.(err);
      }
    }
    return result;
  }
}
