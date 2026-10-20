import type { Router } from 'express';
import type { RewardRules } from '@zoauro/shared';
import { RewardsDatabase } from './rewards.repository';
import { createRewardsRoutes } from './rewards.routes';
import { RewardsService } from './rewards.service';

export { RewardsService } from './rewards.service';

/**
 * Reward points (D169). `service.earnForDeliveredOrder`, `reverseForRefundedOrder`, `redeemAtCheckout` and `expireDue`
 * are for the orders flow, the checkout (intake) and the worker.
 */
export function createRewardsModule(deps: {
  prisma: ConstructorParameters<typeof RewardsDatabase>[0];
  appOrigin: string;
  rules: (zoneId: string) => Promise<RewardRules | null>;
  clock?: () => Date;
}): { router: Router; service: RewardsService } {
  const service = new RewardsService({
    db: new RewardsDatabase(deps.prisma),
    rules: deps.rules,
    clock: deps.clock ?? (() => new Date()),
  });
  return { router: createRewardsRoutes(service, { appOrigin: deps.appOrigin }), service };
}
