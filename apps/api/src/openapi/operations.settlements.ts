import {
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
