import {
  cashSettlementCreatedSchema,
  cashSettlementCreateSchema,
  cashSettlementListQuerySchema,
  cashSettlementListResponseSchema,
  codBalanceListResponseSchema,
  codBalanceQuerySchema,
  payoutIdParamsSchema,
  payoutListQuerySchema,
  payoutMarkPaidSchema,
  payoutRowSchema,
  payoutListResponseSchema,
  payoutDetailSchema,
  payoutOrdersQuerySchema,
  payoutOrdersResponseSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// COD settlement (doc 16 §2, D173) and payouts (doc 16 §5, D152), read only until the settlement form and the payout job.

export const SETTLEMENT_OPERATIONS: OperationDef[] = [
  {
    operationId: 'listCashSettlements',
    method: 'get',
    path: '/cash-settlements',
    tags: ['settlements'],
    summary:
      'COD settlement history: per partner the amount expected, handed in and the variance (?varianceOnly=true), who settled it and when; totals for the filters',
    access: { kind: 'permission', permission: 'settlements:view', zone: 'query' },
    query: cashSettlementListQuerySchema,
    response: { status: 200, schema: cashSettlementListResponseSchema, description: 'One page' },
  },
  {
    operationId: 'createCashSettlement',
    method: 'post',
    path: '/cash-settlements',
    tags: ['settlements'],
    summary:
      'Record the cash a delivery partner handed in (doc 16 §2): expectedPaise is the cash in hand the admin saw (409 when it changed since); a difference needs a note; the partner then holds expected minus handed in. Ledger, audit and settlement.confirmed for the partner app',
    access: { kind: 'permission', permission: 'settlements:add', zone: 'none' },
    audit: { module: 'settlements', action: 'cod_settlement.confirmed' },
    body: cashSettlementCreateSchema,
    response: { status: 201, schema: cashSettlementCreatedSchema, description: 'Recorded' },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
  {
    operationId: 'listCodBalances',
    method: 'get',
    path: '/cash-settlements/balances',
    tags: ['settlements'],
    summary:
      'Each delivery partner’s COD cash in hand (what the next settlement expects) with the last settlement (D173); ?withCash=true for partners holding cash',
    access: { kind: 'permission', permission: 'settlements:view', zone: 'query' },
    query: codBalanceQuerySchema,
    response: { status: 200, schema: codBalanceListResponseSchema, description: 'One page' },
  },
  {
    operationId: 'listPayouts',
    method: 'get',
    path: '/payouts',
    tags: ['payouts'],
    summary:
      'Payouts per payee and cycle (?payeeType for the Figma tabs): gross, commission, net, the vendor-fault refunds decided in the period (D152), status; totals and each zone’s payout cycle',
    access: { kind: 'permission', permission: 'payouts:view', zone: 'query' },
    query: payoutListQuerySchema,
    response: { status: 200, schema: payoutListResponseSchema, description: 'One page' },
  },
  {
    operationId: 'getPayout',
    method: 'get',
    path: '/payouts/{id}',
    tags: ['payouts'],
    summary:
      'One payout (D203): the row plus the money block: vendor-fault refunds (D152), ad fees (D182 A2), COD held for a delivery partner (D202), the amount to pay, the refunds behind the deduction or holding it; 404 outside payouts:view',
    access: { kind: 'permission', permission: 'payouts:view', zone: 'none' },
    params: payoutIdParamsSchema,
    response: { status: 200, schema: payoutDetailSchema, description: 'The payout' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'listPayoutOrders',
    method: 'get',
    path: '/payouts/{id}/orders',
    tags: ['payouts'],
    summary:
      "The payee's DELIVERED orders in the payout period (25 a page, at most 50): commission per order for a vendor, the delivery fee and partner share for a delivery partner (D202); 404 outside payouts:view",
    access: { kind: 'permission', permission: 'payouts:view', zone: 'none' },
    params: payoutIdParamsSchema,
    query: payoutOrdersQuerySchema,
    response: { status: 200, schema: payoutOrdersResponseSchema, description: 'One page' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'markPayoutPaid',
    method: 'post',
    path: '/payouts/{id}/mark-paid',
    tags: ['payouts'],
    summary:
      'Record a manual payout (doc 16 §5): Super Admin only, PASSWORD, If-Match and Idempotency-Key. Only a PENDING payout; a vendor payout waits while the vendor has open refunds in the period (409 open_refunds). Pays the amount to pay (vendor: net − vendor-fault refunds − ad fees; delivery partner, D202: fees × payouts.partnerShare − COD held at period end), kept as paidPaise; ledger VENDOR_PAYABLE or DELIVERY_PAYABLE to PLATFORM_BANK',
    access: { kind: 'permission', permission: 'payouts:edit', zone: 'none', reauth: 'PASSWORD' },
    audit: { module: 'payouts', action: 'payout.marked_paid' },
    params: payoutIdParamsSchema,
    body: payoutMarkPaidSchema,
    idempotent: true,
    ifMatch: true,
    response: { status: 200, schema: payoutRowSchema, description: 'Paid' },
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
];
