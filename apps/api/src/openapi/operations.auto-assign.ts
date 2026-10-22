import {
  autoAssignStateResponseSchema,
  orderIdParamsSchema,
  runAutoAssignResponseSchema,
  runAutoAssignSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// Auto-assign (D154, D199) of one order. Kept apart from operations.ts so the shared registration file only spreads
// this list.

export const AUTO_ASSIGN_OPERATIONS: OperationDef[] = [
  {
    operationId: 'getOrderAutoAssign',
    method: 'get',
    path: '/orders/{id}/auto-assign',
    tags: ['orders'],
    summary:
      "The order zone's auto-assign setting (enabled, radius, retry time, tries), the engine's attempt state (tries, next try, fallback to manual) and the partners it picked (rank, distance); no phone or email",
    access: { kind: 'permission', permission: 'orders:view', zone: 'none' },
    params: orderIdParamsSchema,
    response: { status: 200, schema: autoAssignStateResponseSchema, description: 'The state' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'runOrderAutoAssign',
    method: 'post',
    path: '/orders/{id}/auto-assign',
    tags: ['orders'],
    summary:
      'Try auto-assign again (If-Match: version): starts the count over and runs one try now as the System; the order must be READY without a partner (409 NOT_READY) in a zone that has auto-assign on (409 AUTO_ASSIGN_OFF)',
    access: { kind: 'permission', permission: 'orders:edit', zone: 'none' },
    audit: { module: 'orders', action: 'order.auto_assign_requested' },
    params: orderIdParamsSchema,
    body: runAutoAssignSchema,
    ifMatch: true,
    response: { status: 200, schema: runAutoAssignResponseSchema, description: 'The try' },
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
];
