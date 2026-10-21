import {
  cashSettlementCreatedSchema,
  cashSettlementCreateSchema,
  cashSettlementListQuerySchema,
  cashSettlementListResponseSchema,
  codBalanceListResponseSchema,
  codBalanceQuerySchema,
  payoutListQuerySchema,
  payoutListResponseSchema,
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
];
