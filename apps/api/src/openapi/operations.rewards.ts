import {
  customerIdParamsSchema,
  customerRewardsQuerySchema,
  customerRewardsSchema,
  rewardAdjustSchema,
  rewardConvertSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// Reward points in the customer tab (D169). Zone 'none': the guard checks the permission somewhere, the service the
// customer's zones (404 when the customer is not visible, D25; 403 when loyalty:edit is held in none of them).

const tags = ['customers'];

export const REWARD_OPERATIONS: OperationDef[] = [
  {
    operationId: 'getCustomerRewards',
    method: 'get',
    path: '/customers/{id}/rewards',
    tags,
    summary:
      "A customer's reward points: balance, wallet balance, points expiring in 30 days, the zone's loyalty rules (null = off) and the ledger, newest first",
    access: { kind: 'permission', permission: 'customers:view', zone: 'none' },
    params: customerIdParamsSchema,
    query: customerRewardsQuerySchema,
    response: { status: 200, schema: customerRewardsSchema, description: 'Rewards' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'adjustCustomerRewards',
    method: 'post',
    path: '/customers/{id}/rewards/adjust',
    tags,
    summary:
      'Grant (points > 0) or deduct (points < 0) with a reason. A grant expires after the zone’s expiry days; a deduction spends the oldest points first',
    access: { kind: 'permission', permission: 'loyalty:edit', zone: 'none' },
    audit: { module: 'customers', action: 'customer.points_adjusted' },
    params: customerIdParamsSchema,
    body: rewardAdjustSchema,
    response: { status: 200, schema: customerRewardsSchema, description: 'Adjusted' },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
  {
    operationId: 'convertCustomerRewards',
    method: 'post',
    path: '/customers/{id}/rewards/convert',
    tags,
    summary:
      'Turn points into wallet credit at the zone’s point value, when the zone allows it and the minimum is reached',
    access: { kind: 'permission', permission: 'loyalty:edit', zone: 'none' },
    audit: { module: 'customers', action: 'customer.points_converted' },
    params: customerIdParamsSchema,
    body: rewardConvertSchema,
    response: { status: 200, schema: customerRewardsSchema, description: 'Converted' },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
];
