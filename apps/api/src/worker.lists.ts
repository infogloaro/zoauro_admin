import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { createPrismaClient } from './lib/db';
import type { Env } from './lib/env';
import { RedisRateLimiter } from './lib/rate-limiter';
import { createS3Storage } from './lib/s3-storage';
import { createCustomersModule } from './modules/customers';
import { createPartnersModule } from './modules/delivery-partners';
import type { ListServices } from './modules/exports';
import { createHotelsModule } from './modules/hotels';
import { createMenuModule } from './modules/menu';
import type { NotificationsService } from './modules/notifications';
import type { SettingsReader } from './modules/settings/settings.service';
import type { SupportService } from './modules/support';
import { createVendorsModule } from './modules/vendors';
import { createZonesModule } from './modules/zones';

// The list services the export jobs read (D149), built in the worker the way server.ts builds them, so every export
// the API accepts can run here. The worker serves no routes and uploads nothing: the step-up guard and the uploads gate
// are refusing stand-ins that a list read never reaches (if one ever did, the job fails with ERROR, nothing leaks).

const noRoutes = (): RequestHandler => (_req, _res, next) =>
  next(new Error('the worker serves no routes'));

const listOnlyUploads = {
  assertUploaded: async (): Promise<never> => {
    throw new Error('the worker reads lists only');
  },
};

export function buildWorkerListServices(deps: {
  prisma: ReturnType<typeof createPrismaClient>;
  redis: Redis;
  env: Pick<Env, 'APP_URL' | 'S3_BUCKET' | 'S3_REGION' | 'S3_ENDPOINT'>;
  settings: SettingsReader;
  notifications: NotificationsService;
  support: SupportService;
}): ListServices {
  const { prisma, redis, env, settings } = deps;
  const appOrigin = new URL(env.APP_URL).origin;
  const limiter = new RedisRateLimiter(redis);
  const storage = createS3Storage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  });
  const zones = createZonesModule({ prisma, redis, appOrigin, requireReauth: noRoutes });
  const vendors = createVendorsModule({
    prisma,
    appOrigin,
    requireReauth: noRoutes,
    storage,
    uploads: listOnlyUploads,
    services: zones.service,
    checklist: settings,
    limiter,
  });
  const partners = createPartnersModule({
    prisma,
    appOrigin,
    requireReauth: noRoutes,
    maxConcurrentOrders: (zoneId) => settings.maxConcurrentOrders(zoneId),
    checklist: settings,
    storage,
    uploads: listOnlyUploads,
    limiter,
  });
  const hotels = createHotelsModule({ prisma, appOrigin, services: zones.service });
  return {
    vendors: vendors.service,
    menu: createMenuModule({ prisma, appOrigin, uploads: listOnlyUploads }).items,
    partners: partners.service,
    hotels: hotels.hotels,
    bookings: hotels.bookings,
    notifications: deps.notifications,
    support: deps.support,
    customers: createCustomersModule({ prisma, appOrigin, limiter }).service,
  };
}
