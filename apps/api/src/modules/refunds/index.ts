import type { RequestHandler, Router } from 'express';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { idempotency, IdempotencyRepository } from '../../lib/idempotency';
import { RefundsDatabase } from './refunds.repository';
import { createRefundsRoutes } from './refunds.routes';
import { RefundsService, type RefundsDeps } from './refunds.service';

export { RefundsService } from './refunds.service';

/**
 * Refunds (D180, D187). `service.createFromReport` is for the customer's report through the intake API; the rules and
 * caps come from the settings readers (refunds.rules, refunds.limits).
 */
export function createRefundsModule(deps: {
  prisma: ConstructorParameters<typeof RefundsDatabase>[0];
  appOrigin: string;
  requireReauth: (level: ReauthLevel) => RequestHandler;
  rules: RefundsDeps['rules'];
  caps: RefundsDeps['caps'];
  onFullyRefunded?: RefundsDeps['onFullyRefunded'];
  clock?: () => Date;
}): { router: Router; service: RefundsService } {
  const clock = deps.clock ?? (() => new Date());
  const service = new RefundsService({
    db: new RefundsDatabase(deps.prisma),
    rules: deps.rules,
    caps: deps.caps,
    clock,
    ...(deps.onFullyRefunded ? { onFullyRefunded: deps.onFullyRefunded } : {}),
  });
  return {
    router: createRefundsRoutes(service, {
      appOrigin: deps.appOrigin,
      requireReauth: deps.requireReauth,
      idempotency: idempotency({ store: new IdempotencyRepository(deps.prisma), clock }),
    }),
    service,
  };
}
