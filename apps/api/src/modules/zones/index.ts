import type { RequestHandler, Router } from 'express';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { ImpactService, stubImpactSources, type ImpactSources } from './impact.service';
import { createZonesController } from './zones.controller';
import { redisZonesCacheVersion, type ZonesCacheVersion } from './zones.events';
import { ZonesDatabase } from './zones.repository';
import { createZonesRoutes } from './zones.routes';
import { ZonesService } from './zones.service';

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
export { ZONES_VERSION_KEY, ZONE_UPDATED, ADMIN_ZONES_CHANGED } from './zones.events';

/** M02 Zones (doc 53). Super Admin only. The resolver for the apps (GET /zones/resolve) is P12. */
export function createZonesModule(deps: {
  prisma: ConstructorParameters<typeof ZonesDatabase>[0];
  /** zones:version counter (doc 53 section 2.3) */
  redis: { incr(key: string): Promise<number> };
  appOrigin: string;
  /** the auth module's step-up guard (PASSWORD for status changes and delete) */
  requireReauth: (level: ReauthLevel) => RequestHandler;
  /** default: every source a stub (partial: true) until the owning modules register real ones */
  impactSources?: ImpactSources;
  cache?: ZonesCacheVersion;
  clock?: () => Date;
}): { router: Router; service: ZonesService } {
  const service = new ZonesService({
    db: new ZonesDatabase(deps.prisma),
    impact: new ImpactService(deps.impactSources ?? stubImpactSources()),
    cache: deps.cache ?? redisZonesCacheVersion(deps.redis),
    clock: deps.clock ?? (() => new Date()),
  });
  return {
    router: createZonesRoutes(createZonesController(service), {
      appOrigin: deps.appOrigin,
      requireReauth: deps.requireReauth,
    }),
    service,
  };
}
