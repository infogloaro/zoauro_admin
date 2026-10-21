import {
  assignTicketSchema,
  createTicketSchema,
  ticketDetailSchema,
  ticketIdParamsSchema,
  ticketListQuerySchema,
  ticketListResponseSchema,
  ticketMessageSchema,
  ticketWriteResponseSchema,
  transitionTicketSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// Support desk (doc 57 workstream 8; D93, D98, D139-D141). Kept apart from operations.ts like the other modules.

const tags = ['support'];
const params = ticketIdParamsSchema;
const written = { status: 200 as const, schema: ticketWriteResponseSchema, description: 'Saved' };

export const SUPPORT_OPERATIONS: OperationDef[] = [
  {
    operationId: 'listTickets',
    method: 'get',
    path: '/support/tickets',
    tags,
    summary:
      'Tickets in the zones the caller can view (?zoneId repeatable): status, priority, category, assignee (me / none), customer, order, breached, q (ticket no or subject), from/to, sort, pages. Customer phone masked (D26)',
    access: { kind: 'permission', permission: 'support:view', zone: 'query' },
    query: ticketListQuerySchema,
    response: { status: 200, schema: ticketListResponseSchema, description: 'One page of tickets' },
  },
  {
    operationId: 'createTicket',
    method: 'post',
    path: '/support/tickets',
    tags,
    summary:
      'Open a ticket on a customer’s behalf (D141). Zone = the linked order’s, else the customer’s latest order’s, else the body’s zoneId (D139); auto-assigned round-robin or least busy among the zone’s members with support:edit (D140); SLA deadlines from support.sla',
    access: { kind: 'permission', permission: 'support:edit', zone: 'none' },
    audit: { module: 'support', action: 'ticket.created' },
    body: createTicketSchema,
    response: { ...written, status: 201, description: 'Created' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'getTicket',
    method: 'get',
    path: '/support/tickets/{id}',
    tags,
    summary:
      'One ticket with its replies and internal notes and the statuses /transition accepts now. 404 outside the caller’s view scope',
    access: { kind: 'permission', permission: 'support:view', zone: 'none' },
    params,
    response: { status: 200, schema: ticketDetailSchema, description: 'The ticket' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'addTicketMessage',
    method: 'post',
    path: '/support/tickets/{id}/messages',
    tags,
    summary:
      'A PUBLIC reply to the customer (the first one stops the first-response clock) or an INTERNAL note; up to 5 upload keys',
    access: { kind: 'permission', permission: 'support:edit', zone: 'none' },
    audit: { module: 'support', action: 'ticket.replied' },
    params,
    body: ticketMessageSchema,
    response: { ...written, status: 201, description: 'Added' },
    errors: ['NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  },
  {
    operationId: 'transitionTicket',
    method: 'post',
    path: '/support/tickets/{id}/transition',
    tags,
    summary:
      'Move a ticket (If-Match: version): WAITING_CUSTOMER pauses the SLA clock, ASSIGNED resumes it, RESOLVED, CLOSED, REOPENED within support.sla.reopenWithinDays (D139)',
    access: { kind: 'permission', permission: 'support:edit', zone: 'none' },
    audit: { module: 'support', action: 'ticket.status_changed' },
    params,
    body: transitionTicketSchema,
    ifMatch: true,
    response: written,
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
  {
    operationId: 'assignTicket',
    method: 'post',
    path: '/support/tickets/{id}/assign',
    tags,
    summary:
      'Assign (If-Match: version) to a member holding support:edit in the ticket’s zone, or null for the automatic choice (D140)',
    access: { kind: 'permission', permission: 'support:edit', zone: 'none' },
    audit: { module: 'support', action: 'ticket.assigned' },
    params,
    body: assignTicketSchema,
    ifMatch: true,
    response: written,
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
];
