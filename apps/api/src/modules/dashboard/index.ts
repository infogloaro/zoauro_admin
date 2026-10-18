import type { Router } from 'express';
import type { Redis } from 'ioredis';
import { DashboardRepository } from './dashboard.repository';
import { createDashboardRoutes } from './dashboard.routes';
import { DashboardService } from './dashboard.service';

// Dashboard tiles (M16; doc 09 /dashboard/*, SA-5.1, ZA-5.1): scoped per tile, cached 30 s by scope hash.

export { DashboardService } from './dashboard.service';

export function createDashboardModule(deps: {
  prisma: ConstructorParameters<typeof DashboardRepository>[0];
  /** null: no cache (tests) */
  redis: Pick<Redis, 'get' | 'set'> | null;
  clock?: () => Date;
}): { router: Router; service: DashboardService } {
  const service = new DashboardService({
    repo: new DashboardRepository(deps.prisma),
    redis: deps.redis,
    clock: deps.clock ?? (() => new Date()),
  });
  return { router: createDashboardRoutes(service), service };
}
