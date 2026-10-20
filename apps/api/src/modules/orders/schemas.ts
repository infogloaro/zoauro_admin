// Request and response schemas of the orders routes. They live in packages/shared (AGENTS.md: Zod schemas are shared
// with the web client and the OpenAPI document), and are re-exported here so the module keeps what it uses in one place.

export {
  ADMIN_CANCELLABLE,
  ADMIN_TRANSITIONS,
  ORDER_STATUSES,
  ORDER_TRANSITION_TARGETS,
  nextAdminStatuses,
  orderCancelSchema,
  orderDetailSchema,
  orderIdParamsSchema,
  orderListItemSchema,
  orderListQuerySchema,
  orderListResponseSchema,
  orderTransitionSchema,
} from '@zoauro/shared';
