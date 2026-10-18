import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  multiValue,
  pageMetaSchema,
  sortSchema,
} from '../pagination';

// Support desk (doc 57 workstream 8; D93, D98, D139-D141). Tickets belong to one zone (the linked order's, else the
// customer's latest order's, else the zone named on creation), are created by admins on a customer's behalf in v1 and
// carry PUBLIC replies and INTERNAL notes. One SLA (settings support.sla, per-zone override) for every priority.

export const TICKET_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Stored as text (doc 32): ticket categories the desk sorts by. */
export const TICKET_CATEGORIES = [
  'ORDER',
  'PAYMENT_REFUND',
  'DELIVERY',
  'ACCOUNT',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_MESSAGE_VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;
export type TicketMessageVisibility = (typeof TICKET_MESSAGE_VISIBILITIES)[number];

/**
 * D139 state machine. ASSIGNED is reached through /assign (or auto-assignment), never through /transition. Leaving
 * WAITING_CUSTOMER resumes the SLA clock; REOPENED is allowed only within support.sla.reopenWithinDays of resolving.
 */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  OPEN: ['WAITING_CUSTOMER', 'RESOLVED'],
  ASSIGNED: ['WAITING_CUSTOMER', 'RESOLVED'],
  WAITING_CUSTOMER: ['ASSIGNED', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  REOPENED: ['WAITING_CUSTOMER', 'RESOLVED'],
  CLOSED: [],
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

/** Statuses whose SLA clock runs (WAITING_CUSTOMER pauses it, D139). */
export const TICKET_CLOCK_RUNNING: readonly TicketStatus[] = ['OPEN', 'ASSIGNED', 'REOPENED'];

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().datetime({ offset: true });

// ---- requests --------------------------------------------------------------------------------------------------------

export const ticketListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    sort: sortSchema(['createdAt', 'resolutionDueAt', 'priority'], {
      field: 'createdAt',
      direction: 'desc',
    }),
    /** ticket number or subject contains (case-insensitive) */
    q: z.string().trim().min(1).max(100).optional(),
    status: multiValue(z.enum(TICKET_STATUSES)),
    priority: multiValue(z.enum(TICKET_PRIORITIES)),
    category: multiValue(z.enum(TICKET_CATEGORIES)),
    assigneeId: z.uuid().optional(),
    /** `me`: tickets assigned to the caller; `none`: unassigned */
    assigned: z.enum(['me', 'none']).optional(),
    customerId: z.uuid().optional(),
    orderId: z.uuid().optional(),
    /** SLA breached: escalated, or past the resolution deadline while the clock runs */
    breached: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

export const ticketIdParamsSchema = z.object({ id: z.uuid() });

/** POST /support/tickets (D141: an admin on a customer's behalf). zoneId only when no order links the ticket. */
export const createTicketSchema = z
  .object({
    customerId: z.uuid(),
    orderId: z.uuid().optional(),
    refundId: z.uuid().optional(),
    zoneId: z.uuid().optional(),
    category: z.enum(TICKET_CATEGORIES),
    priority: z.enum(TICKET_PRIORITIES).default('NORMAL'),
    subject: text(200),
    /** the customer's request, stored as the first PUBLIC message (author: the creating admin) */
    description: text(5000),
  })
  .strict();
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const ticketMessageSchema = z
  .object({
    visibility: z.enum(TICKET_MESSAGE_VISIBILITIES),
    body: text(5000),
    /** upload keys from POST /uploads (SA-2.1), at most 5 */
    attachmentKeys: z.array(z.string().min(1).max(300)).max(5).default([]),
  })
  .strict();
export type TicketMessageInput = z.infer<typeof ticketMessageSchema>;

/**
 * POST /support/tickets/{id}/transition (If-Match: version). ASSIGNED here only resumes a ticket waiting on the
 * customer (the assignee stays); /assign (re)assigns. OPEN is never a target.
 */
export const transitionTicketSchema = z
  .object({
    to: z.enum(TICKET_STATUSES).refine((s) => s !== 'OPEN', { message: 'OPEN is not a target' }),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type TransitionTicketInput = z.infer<typeof transitionTicketSchema>;

/** POST /support/tickets/{id}/assign (If-Match: version): a member, or null for the automatic choice (D140). */
export const assignTicketSchema = z.object({ assigneeId: z.uuid().nullable() }).strict();
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

// ---- responses -------------------------------------------------------------------------------------------------------

const iso = z.string();

export const ticketListItemSchema = z.object({
  id: z.uuid(),
  ticketNo: z.string(),
  zoneId: z.uuid(),
  status: z.enum(TICKET_STATUSES),
  priority: z.enum(TICKET_PRIORITIES),
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string(),
  customerId: z.uuid(),
  customerName: z.string(),
  /** masked (D26) */
  customerPhoneMasked: z.string(),
  orderId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  assignee: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  firstResponseDueAt: iso,
  resolutionDueAt: iso,
  escalatedAt: iso.nullable(),
  /** escalated, or past the resolution deadline while the clock runs */
  breached: z.boolean(),
  createdAt: iso,
  version: z.number().int(),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

export const ticketListResponseSchema = z.object({
  data: z.array(ticketListItemSchema),
  meta: pageMetaSchema,
});
export type TicketListResponse = z.infer<typeof ticketListResponseSchema>;

export const ticketMessageItemSchema = z.object({
  id: z.uuid(),
  visibility: z.enum(TICKET_MESSAGE_VISIBILITIES),
  body: z.string(),
  attachmentKeys: z.array(z.string()),
  author: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: iso,
});

export const ticketDetailSchema = ticketListItemSchema.extend({
  source: z.enum(['ADMIN', 'APP']),
  escalationDueAt: iso,
  firstRespondedAt: iso.nullable(),
  pausedAt: iso.nullable(),
  resolvedAt: iso.nullable(),
  closedAt: iso.nullable(),
  reopenCount: z.number().int(),
  messages: z.array(ticketMessageItemSchema),
  /** statuses /transition accepts now (D139) */
  allowedTransitions: z.array(z.enum(TICKET_STATUSES)),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ticketWriteResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(TICKET_STATUSES),
  assigneeId: z.uuid().nullable(),
  version: z.number().int(),
});
export type TicketWriteResponse = z.infer<typeof ticketWriteResponseSchema>;
