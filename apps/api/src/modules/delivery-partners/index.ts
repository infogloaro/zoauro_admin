import type { RequestHandler, Router } from 'express';
import type { ReauthLevel } from '../../lib/auth/session-store';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { ObjectStorage } from '../../lib/storage';
import { PartnersDatabase } from './partners.repository';
import { createPartnersRoutes } from './partners.routes';
import {
  PartnersService,
  type PartnerChecklistSource,
  type PartnerClaimGuard,
  type PartnerUploadsGate,
} from './partners.service';

// Delivery partners (M10) and Partner Requests (R12; D130–D133). Ported to the core pattern of the vendors module.

export { PartnersService } from './partners.service';

export function createPartnersModule(deps: {
  prisma: ConstructorParameters<typeof PartnersDatabase>[0];
  appOrigin: string;
  requireReauth: (level: ReauthLevel) => RequestHandler;
  /** D121: the effective delivery.maxConcurrentOrders of a zone (settings reader) */
  maxConcurrentOrders: (zoneId: string) => Promise<number>;
  /** D173: the effective delivery.codLimitPaise of a zone (settings reader) */
  codLimit?: (zoneId: string) => Promise<number>;
  /** D97: settings onboarding.documents (settings reader) */
  checklist: PartnerChecklistSource;
  storage: ObjectStorage;
  /** the uploads module's fileKey gate (D120) */
  uploads: PartnerUploadsGate;
  limiter: RateLimiter;
  /** D174 record claims (the access module) */
  claims?: PartnerClaimGuard;
  clock?: () => Date;
}): {
  router: Router;
  service: PartnersService;
  /** for the uploads module: who owns a partner id (unscoped) */
  entities: { ownerOf(id: string): Promise<{ module: 'delivery'; zoneId: string | null } | null> };
} {
  const db = new PartnersDatabase(deps.prisma);
  const service = new PartnersService({
    db,
    clock: deps.clock ?? (() => new Date()),
    maxConcurrentOrders: deps.maxConcurrentOrders,
    ...(deps.codLimit ? { codLimit: deps.codLimit } : {}),
    checklist: deps.checklist,
    storage: deps.storage,
    uploads: deps.uploads,
    limiter: deps.limiter,
    ...(deps.claims ? { claims: deps.claims } : {}),
  });
  return {
    router: createPartnersRoutes(service, {
      appOrigin: deps.appOrigin,
      requireReauth: deps.requireReauth,
    }),
    service,
    entities: { ownerOf: (id) => db.repo.ownerOf(id) },
  };
}
