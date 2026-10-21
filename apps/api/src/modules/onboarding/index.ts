import { Router } from 'express';
import {
  ONBOARDING_MODULES,
  onboardingListQuerySchema,
  onboardingMoreInfoSchema,
  onboardingRecordParamsSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { OnboardingDatabase } from './onboarding.repository';
import { OnboardingService, type OnboardingDeps } from './onboarding.service';

export { OnboardingService } from './onboarding.service';

const NOUN = { restaurants: 'Restaurant', homemakers: 'Homemaker', hotels: 'Hotel' } as const;

/**
 * D170 onboarding queue: GET /onboarding (one queue over restaurants, homemakers and hotels, per-module view scope) and,
 * per module, POST /{module}/{id}/onboarding/review and /more-info (`<module>:status` in the record's zone).
 */
export function createOnboardingModule(deps: {
  prisma: ConstructorParameters<typeof OnboardingDatabase>[0];
  appOrigin: string;
  claims: OnboardingDeps['claims'];
  clock?: () => Date;
}): { router: Router; service: OnboardingService } {
  const service = new OnboardingService({
    db: new OnboardingDatabase(deps.prisma),
    claims: deps.claims,
    clock: deps.clock ?? (() => new Date()),
  });
  const router = Router();
  // view passes the guard for any signed-in admin; each table is then bounded by its own module's view zones
  router.get('/onboarding', requirePermission('restaurants', 'view'), async (req, res) => {
    res.json(
      await service.list(authContextOf(res), parseBody(onboardingListQuerySchema, req.query)),
    );
  });
  for (const module of ONBOARDING_MODULES) {
    const write = [originCheck(deps.appOrigin), requirePermission(module, 'status'), requireCsrf];
    const id = (p: unknown) => parseBody(onboardingRecordParamsSchema, p).id;
    router.post(
      `/${module}/:id/onboarding/review`,
      ...write,
      auditMeta(auditOf(`start${NOUN[module]}Review`)),
      async (req, res) => {
        res.json(await service.startReview(authContextOf(res), module, id(req.params)));
      },
    );
    router.post(
      `/${module}/:id/onboarding/more-info`,
      ...write,
      requireJsonBody,
      auditMeta(auditOf(`request${NOUN[module]}MoreInfo`)),
      async (req, res) => {
        res.json(
          await service.requestMoreInfo(
            authContextOf(res),
            module,
            id(req.params),
            parseBody(onboardingMoreInfoSchema, req.body),
          ),
        );
      },
    );
  }
  return { router, service };
}
