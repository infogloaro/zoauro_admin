import { Router } from 'express';
import { searchQuerySchema } from '@zoauro/shared';
import { requireSession } from '../../lib/auth/middleware';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';

// Global header search (M18; doc 09 GET /search, D143). The route needs a session only; every group is gated by its
// own module's view zones in the service.

export { SearchService } from './search.service';

export function createSearchModule(deps: {
  prisma: ConstructorParameters<typeof SearchRepository>[0];
  limiter: RateLimiter;
}): { router: Router; service: SearchService } {
  const service = new SearchService({
    repo: new SearchRepository(deps.prisma),
    limiter: deps.limiter,
  });
  const router = Router();
  router.get('/search', requireSession(), async (req, res) => {
    res.json(await service.search(authContextOf(res), parseBody(searchQuerySchema, req.query)));
  });
  return { router, service };
}
