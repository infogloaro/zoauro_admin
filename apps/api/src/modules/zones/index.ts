import type { RequestHandler, Router } from 'express';
import type { Redis } from 'ioredis';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { ImpactService, stubImpactSources, type ImpactSources } from './impact.service';
import { createZonesController } from './zones.controller';
import { redisZonesCacheVersion, type ZonesCacheVersion } from './zones.events';
import { ZonesDatabase } from './zones.repository';
import { createZonesRoutes } from './zones.routes';
import { ZonesService } from './zones.service';
import { redisResolveCache, ZoneResolver, type ResolveCache } from './resolve.service';

export {
  stubImpactSources,
  stubCountPort,
  stubTeamPort,
  stubMismatchPort,
  impactVersionOf,
  type ImpactSources,
  type ZoneCountPort,
  type ZoneTeamPort,
  type ZoneMismatchPort,
} from './impact.service';
export { createZoneCountPorts } from './impact.repository';
export { ZONES_VERSION_KEY, ZONE_UPDATED, ADMIN_ZONES_CHANGED } from './zones.events';
export { ZoneResolver, type ZoneResolution, type ResolveInput } from './resolve.service';
export { RESOLVE_SCOPE, type ResolveCaller } from './resolve.caller';

/**
 * M02 Zones (doc 53). The admin routes are Super Admin only. `resolver` answers zone resolution for the apps; its route
 * (GET /zones/resolve, scope zones:resolve, per-client rate limit) is registered by the intake module, not built yet.
 */
export function createZonesModule(deps: {
  prisma: ConstructorParameters<typeof ZonesDatabase>[0];
  /** zones:version counter and the resolver cache zones:pin:<pincode> (doc 53 section 2.3) */
  redis: Redis;
  appOrigin: string;
  /** the auth module's step-up guard (PASSWORD for status changes and delete) */
  requireReauth: (level: ReauthLevel) => RequestHandler;
  /** default: every source a stub (partial: true) until the owning modules register real ones */
  impactSources?: ImpactSources;
  cache?: ZonesCacheVersion;
  resolveCache?: ResolveCache;
  clock?: () => Date;
  /** D178: the Control Panel area guard (the access module's ControlAreasService) */
  requireArea?: (area: (req: Parameters<RequestHandler>[0]) => string | null) => RequestHandler;
  /** D165: settings zones.deliveryChargeCapPaise (the settings reader); absent = the Rs 1,000 ceiling */
  deliveryChargeCap?: () => Promise<number>;
}): { router: Router; service: ZonesService; resolver: ZoneResolver } {
  const db = new ZonesDatabase(deps.prisma);
  const service = new ZonesService({
    db,
    impact: new ImpactService(deps.impactSources ?? stubImpactSources()),
    cache: deps.cache ?? redisZonesCacheVersion(deps.redis),
    clock: deps.clock ?? (() => new Date()),
    ...(deps.deliveryChargeCap ? { deliveryChargeCap: deps.deliveryChargeCap } : {}),
  });
  return {
    router: createZonesRoutes(createZonesController(service), {
      appOrigin: deps.appOrigin,
      requireReauth: deps.requireReauth,
      ...(deps.requireArea ? { requireArea: deps.requireArea } : {}),
    }),
    service,
    resolver: new ZoneResolver({
      repo: () => db.repo,
      cache: deps.resolveCache ?? redisResolveCache(deps.redis),
      onCacheError: (err) =>
        console.error(
          `zone resolve cache unavailable ${err instanceof Error ? err.name : 'unknown'}`,
        ),
    }),
  };
}
