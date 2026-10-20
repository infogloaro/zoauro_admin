import {
  customerBlockSchema,
  customerContactSchema,
  customerCreateSchema,
  customerDetailSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  customerListResponseSchema,
  customerUnblockSchema,
  customerUpdateSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// M09 Customers (doc 09, D14, D25, D26, D28, D63). Object routes are zone 'none': the guard checks the module permission
// somewhere, the service the customer's zones (404 when the customer is not visible, D25; 403 when the action is held in
// none of their visible zones).

const tags = ['customers'];

export const CUSTOMER_OPERATIONS: OperationDef[] = [
  {
    operationId: 'listCustomers',
    method: 'get',
    path: '/customers',
    tags,
    summary:
      'Customers with an address or an order in the zones the caller can view (D25, ?zoneId repeatable): search q (name, phone, email), status, source, sort, pages, tab counts. Orders and total spent are scope-filtered; phone and email masked (D26)',
    access: { kind: 'permission', permission: 'customers:view', zone: 'query' },
    query: customerListQuerySchema,
    response: { status: 200, schema: customerListResponseSchema, description: 'One page' },
  },
  {
    operationId: 'createCustomer',
    method: 'post',
    path: '/customers',
    tags,
    summary:
      'Add a customer (D28: source ADMIN, unique phone, no login) with a first address in a zone the caller can add customers to',
    access: { kind: 'permission', permission: 'customers:add', zone: 'none' },
    audit: { module: 'customers', action: 'customer.created' },
    body: customerCreateSchema,
    response: { status: 201, schema: customerDetailSchema, description: 'Created' },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
  {
    operationId: 'getCustomer',
    method: 'get',
    path: '/customers/{id}',
    tags,
    summary:
      'One customer: in-scope addresses, the 10 latest in-scope orders, scope-filtered figures (D25). 404 when not visible',
    access: { kind: 'permission', permission: 'customers:view', zone: 'none' },
    params: customerIdParamsSchema,
    response: { status: 200, schema: customerDetailSchema, description: 'The customer' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'updateCustomer',
    method: 'patch',
    path: '/customers/{id}',
    tags,
    summary: 'Edit name, phone (unique) or email',
    access: { kind: 'permission', permission: 'customers:edit', zone: 'none' },
    audit: { module: 'customers', action: 'customer.updated' },
    params: customerIdParamsSchema,
    body: customerUpdateSchema,
    response: { status: 200, schema: customerDetailSchema, description: 'Saved' },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
  {
    operationId: 'blockCustomer',
    method: 'post',
    path: '/customers/{id}/block',
    tags,
    summary: 'Block with a reason (kept in the audit trail)',
    access: { kind: 'permission', permission: 'customers:status', zone: 'none' },
    audit: { module: 'customers', action: 'customer.blocked' },
    params: customerIdParamsSchema,
    body: customerBlockSchema,
    response: { status: 200, schema: customerDetailSchema, description: 'Blocked' },
    errors: ['NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  },
  {
    operationId: 'unblockCustomer',
    method: 'post',
    path: '/customers/{id}/unblock',
    tags,
    summary: 'Unblock (back to ACTIVE)',
    access: { kind: 'permission', permission: 'customers:status', zone: 'none' },
    audit: { module: 'customers', action: 'customer.unblocked' },
    params: customerIdParamsSchema,
    body: customerUnblockSchema,
    response: { status: 200, schema: customerDetailSchema, description: 'Unblocked' },
    errors: ['NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  },
  {
    operationId: 'revealCustomerContact',
    method: 'get',
    path: '/customers/{id}/reveal',
    tags,
    summary:
      'The unmasked phone and email (D26): the reveal flag in a zone where the customer is visible (Super Admin always), audited, 30 per hour',
    access: { kind: 'permission', permission: 'customers:view', zone: 'none' },
    params: customerIdParamsSchema,
    response: { status: 200, schema: customerContactSchema, description: 'Contact details' },
    errors: ['NOT_FOUND', 'FORBIDDEN', 'RATE_LIMITED'],
  },
];
