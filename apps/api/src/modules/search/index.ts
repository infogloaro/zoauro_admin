import type { Router } from 'express';
import { createSearchController } from './controller';
import { PrismaSearchRepository } from './prisma-repository';
import { createSearchRoutes } from './routes';
import { SearchService } from './service';

export { SEARCH_PERMISSION, searchScope, patterns } from './service';
export type { SearchRepository } from './repository';
export type * from './types';

/** M18 Global Search (doc 09 GET /search, D32, doc 34 SA-7.5). server.ts mounts the router under /api/v1. */
export function createSearchModule(deps: {
  prisma: ConstructorParameters<typeof PrismaSearchRepository>[0];
}): { router: Router } {
  const service = new SearchService(new PrismaSearchRepository(deps.prisma));
  return { router: createSearchRoutes(createSearchController(service)) };
}
