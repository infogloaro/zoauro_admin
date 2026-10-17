import type { RequestHandler, Router } from 'express';
import type { ReauthLevel } from '../../lib/auth/session-store';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { ObjectStorage } from '../../lib/storage';
import { VendorsDatabase } from './vendors.repository';
import { createVendorsRoutes } from './vendors.routes';
import { VendorsService, type VendorsDeps } from './vendors.service';

export { VendorsService } from './vendors.service';
export { VENDOR_STATUS_CHANGED, VENDOR_UPDATED } from './vendors.events';

/**
 * M06 Restaurants and M07 Home Food (doc 09, D117-D123). `entities` is the uploads module's view of who owns an upload
 * key (the vendor and its zone).
 */
export function createVendorsModule(deps: {
  prisma: ConstructorParameters<typeof VendorsDatabase>[0];
  appOrigin: string;
  requireReauth: (level: ReauthLevel) => RequestHandler;
  storage: ObjectStorage;
  uploads: VendorsDeps['uploads'];
  services: VendorsDeps['services'];
  checklist: VendorsDeps['checklist'];
  limiter: RateLimiter;
  clock?: () => Date;
}): { router: Router; service: VendorsService; entities: VendorsDatabase['repo'] } {
  const db = new VendorsDatabase(deps.prisma);
  const service = new VendorsService({
    db,
    storage: deps.storage,
    uploads: deps.uploads,
    services: deps.services,
    checklist: deps.checklist,
    limiter: deps.limiter,
    clock: deps.clock ?? (() => new Date()),
  });
  return {
    router: createVendorsRoutes(service, {
      appOrigin: deps.appOrigin,
      requireReauth: deps.requireReauth,
    }),
    service,
    entities: db.repo,
  };
}
