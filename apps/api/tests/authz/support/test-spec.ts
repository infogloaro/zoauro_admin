import type { OpenApiLike } from '../matrix/engine';
import type { Binding } from '../matrix/engine';

// OpenAPI-shaped description of the test-only routes in test-router.ts. It has exactly the parts the matrix engine
// reads (operationId, requestBody, x-access), so permission routes with every zone behaviour are exercised before
// real zone-owned modules exist.

export const TEST_SPEC: OpenApiLike = {
  paths: {
    '/_t/orders': {
      get: {
        operationId: 'testListOrders',
        'x-access': { kind: 'permission', permission: 'orders:view', zone: 'query' },
      },
      patch: {
        operationId: 'testBulkEditOrders',
        'x-access': { kind: 'permission', permission: 'orders:edit', zone: 'none' },
      },
    },
    '/_t/payments': {
      get: {
        operationId: 'testListPayments',
        'x-access': { kind: 'permission', permission: 'payments:view', zone: 'query' },
      },
    },
    '/_t/orders/in/{zoneId}': {
      get: {
        operationId: 'testGetOrderInZone',
        'x-access': { kind: 'permission', permission: 'orders:view', zone: 'path' },
      },
      patch: {
        operationId: 'testEditOrderInZone',
        'x-access': { kind: 'permission', permission: 'orders:edit', zone: 'path' },
      },
    },
    '/_t/access': {
      get: {
        operationId: 'testGetAccess',
        'x-access': { kind: 'permission', permission: 'access:view', zone: 'none' },
      },
      put: {
        operationId: 'testPutAccess',
        'x-access': { kind: 'permission', permission: 'access:edit', zone: 'none' },
      },
    },
    '/_t/ctx': {
      get: {
        operationId: 'testGetContext',
        'x-access': { kind: 'permission', permission: 'dashboard:view', zone: 'none' },
      },
    },
  },
};

const scopeOf = (body: unknown): string[] | 'ALL' => {
  const scope = (body as { scope?: { kind: string; zoneIds?: string[] } }).scope;
  return scope?.kind === 'ALL' ? 'ALL' : (scope?.zoneIds ?? []);
};

export const TEST_BINDINGS: Record<string, Binding> = {
  testListOrders: { listedZones: scopeOf },
  testListPayments: { listedZones: scopeOf },
};
