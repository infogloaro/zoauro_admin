import {
  orderIdParamsSchema,
  rescheduleOrderResponseSchema,
  rescheduleOrderSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// Pre-orders (D150, D167). Kept apart from operations.ts so the shared registration file only spreads this list.

export const PREORDER_OPERATIONS: OperationDef[] = [
  {
    operationId: 'rescheduleOrder',
    method: 'post',
    path: '/orders/{id}/reschedule',
    tags: ['orders'],
    summary:
      'Move a pre-order to a new time (If-Match: version) inside the orders.preorder window (422 TOO_SOON / TOO_FAR_AHEAD), before the reschedule cut-off and under the reschedule cap (409); recomputes dispatch_at and emits order.rescheduled',
    access: { kind: 'permission', permission: 'orders:edit', zone: 'none' },
    audit: { module: 'orders', action: 'order.rescheduled' },
    params: orderIdParamsSchema,
    body: rescheduleOrderSchema,
    ifMatch: true,
    response: { status: 200, schema: rescheduleOrderResponseSchema, description: 'Rescheduled' },
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
];
