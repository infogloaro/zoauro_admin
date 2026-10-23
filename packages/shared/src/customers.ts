import { z } from 'zod';
import {
  CUSTOMER_SOURCES,
  CUSTOMER_STATUSES,
  REWARD_ADJUST_ACTIONS,
  REWARD_ENTRY_TYPES,
  USER_TYPES,
  WALLET_ENTRY_TYPES,
} from './enums';
import { phoneSchema } from './vendor';

/**
 * M09 Customers contracts — doc 08 (`customers`, `customer_addresses`),
 * doc 09 (`/customers`), docs 20/22 (profile and Add Customer form),
 * D25 (scope visibility), D26 (masked lists, audited reveal), D28
 * (`source=ADMIN` for admin-created customers).
 *
 * Contact columns arrive masked in list and profile responses (doc 15);
 * `GET /customers/{id}/reveal` is the audited unmask and is gated by
 * `customers:reveal` (docs 04, 39, 40 — doc 09 lists `customers:view` there,
 * logged as a doc conflict in doc 32).
 *
 * Orders and refunds are not embedded: the orders/refunds modules land with
 * M11/M13, so the profile carries the scope-filtered aggregates (D25) and the
 * profile's Orders/Refunds sections render pending empty states until those
 * endpoints exist.
 */

export const CUSTOMER_SORT_FIELDS = ['createdAt', 'name', 'totalSpent'] as const;

const customerZoneRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
});

/** Doc 08 `customers` row; aggregates are scope-filtered (D25, TC-MZ-12). */
export const customerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Masked in list responses (`98****1234`, doc 15 / D26). */
  phone: z.string(),
  /** Masked in list responses; nullable stays masked until reveal. */
  email: z.string().nullable(),
  status: z.enum(CUSTOMER_STATUSES),
  source: z.enum(CUSTOMER_SOURCES),
  userType: z.enum(USER_TYPES),
  /** Integer paise (AGENTS.md money rule). */
  walletBalance: z.number().int(),
  /** Orders in the member's zone scope only (D25). */
  orderCount: z.number().int(),
  /** Spend in the member's zone scope only (D25), integer paise. */
  totalSpentPaise: z.number().int(),
  /** Zones where the customer has an address or order in scope (D25). */
  zones: z.array(customerZoneRefSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Customer = z.infer<typeof customerSchema>;

/* ------------------------------------------------------------------ *
 * API payloads
 * ------------------------------------------------------------------ */

/**
 * POST /customers (doc 09, `customers:add`). `source` is set to ADMIN
 * server-side (D28) and is never accepted from the client. The first
 * address is part of the create payload so admin-created customers are
 * visible to Zonal Admins under D25 (doc 22 form row).
 */
export const customerCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: phoneSchema,
  email: z.email('Enter a valid email').max(254).optional(),
  zoneId: z.uuid('Choose a zone'),
  address: z.string().trim().min(3, 'Address is required').max(240),
  area: z.string().trim().min(1).max(80).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

/**
 * PATCH /customers/{id} (doc 09, `customers:edit`) — profile fields only.
 * Phone stays stable (D26: reveal, not edit) and block/unblock have their
 * own audited endpoints.
 */
export const customerUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.email('Enter a valid email').max(254).nullable().optional(),
    status: z.enum(CUSTOMER_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

/**
 * GET /customers/{id}/reveal (doc 09, audited unmask of phone/email, D26).
 * Gated by `customers:reveal`.
 */
export const customerRevealSchema = z.object({
  phone: z.string(),
  email: z.string().nullable(),
});

export type CustomerReveal = z.infer<typeof customerRevealSchema>;

/* ------------------------------------------------------------------ *
 * List query
 * ------------------------------------------------------------------ */

/** doc 09 list conventions + doc 22 filters (status, area, user type, source). */
export const listCustomersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(120).optional(),
    status: z.enum(CUSTOMER_STATUSES).optional(),
    source: z.enum(CUSTOMER_SOURCES).optional(),
    userType: z.enum(USER_TYPES).optional(),
    area: z.string().trim().min(1).max(80).optional(),
    zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
    /** createdAt lower bound — ISO date (YYYY-MM-DD) or full ISO datetime. */
    from: z.iso
      .date()
      .or(z.iso.datetime({ offset: true }))
      .optional(),
    /** createdAt upper bound — date-only covers the whole day (doc 09). */
    to: z.iso
      .date()
      .or(z.iso.datetime({ offset: true }))
      .optional(),
    sort: z
      .string()
      .regex(/^-?(createdAt|name|totalSpent)$/u, 'Unsupported sort field')
      .default('-createdAt'),
  })
  .refine(
    (v) =>
      v.from === undefined ||
      v.to === undefined ||
      // Date-only `to` covers the whole day, so a same-day datetime `from` still fits.
      Date.parse(v.from) <=
        Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(v.to) ? `${v.to}T23:59:59.999Z` : v.to),
    {
      message: '`from` must not be after `to`',
      path: ['from'],
    },
  );

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09). */
export function requestedCustomerZoneIds(query: ListCustomersQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

/** Doc 08 `customer_addresses` — one row of the profile's address list. */
export const customerAddressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  address: z.string(),
  area: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  pincode: z.string().nullable(),
  zoneId: z.uuid(),
  zone: customerZoneRefSchema,
  isDefault: z.boolean(),
});

export type CustomerAddress = z.infer<typeof customerAddressSchema>;

/** Doc 20: profile = contact, addresses, orders, refunds, status. */
export const customerDetailSchema = customerSchema.extend({
  addresses: z.array(customerAddressSchema),
});

export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const customerCountsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  blocked: z.number().int(),
  inactive: z.number().int(),
});

export const customerFacetsSchema = z.object({
  areas: z.array(z.string()),
  sources: z.array(z.enum(CUSTOMER_SOURCES)),
  zones: z.array(customerZoneRefSchema),
});

export const listCustomersResponseSchema = z.object({
  data: z.array(customerSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: customerCountsSchema,
    facets: customerFacetsSchema,
  }),
});

export type ListCustomersResponse = z.infer<typeof listCustomersResponseSchema>;

/* ------------------------------------------------------------------ *
 * Rewards (D169, doc 09 `/customers/{id}/rewards|adjust|convert`)
 * ------------------------------------------------------------------ */

/** One `reward_point_entries` row (append-only ledger, signed `points`). */
export const customerRewardEntrySchema = z.object({
  id: z.uuid(),
  type: z.enum(REWARD_ENTRY_TYPES),
  points: z.number().int(),
  orderId: z.uuid().nullable(),
  reason: z.string().nullable(),
  actorId: z.uuid().nullable(),
  zoneId: z.uuid().nullable(),
  createdAt: z.string(),
});

export type CustomerRewardEntry = z.infer<typeof customerRewardEntrySchema>;

export const listRewardsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(REWARD_ENTRY_TYPES).optional(),
});

export type ListRewardsQuery = z.infer<typeof listRewardsQuerySchema>;

/** `{ data: { rewardPoints, entries }, meta }` — module list envelope. */
export const listRewardsResponseSchema = z.object({
  data: z.object({
    rewardPoints: z.number().int(),
    entries: z.array(customerRewardEntrySchema),
  }),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});

export type ListRewardsResponse = z.infer<typeof listRewardsResponseSchema>;

/** POST /customers/{id}/rewards/adjust — `points` is a positive magnitude. */
export const rewardAdjustSchema = z.object({
  action: z.enum(REWARD_ADJUST_ACTIONS),
  points: z.number().int().min(1, 'Points must be at least 1'),
  reason: z.string().trim().min(3, 'Reason is required').max(300),
});

export type RewardAdjustInput = z.infer<typeof rewardAdjustSchema>;

export const rewardAdjustResponseSchema = z.object({
  data: z.object({
    rewardPoints: z.number().int(),
    entry: customerRewardEntrySchema,
  }),
});

export type RewardAdjustResponse = z.infer<typeof rewardAdjustResponseSchema>;

/** POST /customers/{id}/rewards/convert — body; the endpoint always 409s today (D101). */
export const rewardConvertSchema = z.object({
  points: z.number().int().min(1, 'Points must be at least 1'),
});

export type RewardConvertInput = z.infer<typeof rewardConvertSchema>;

/* ------------------------------------------------------------------ *
 * Wallet (D24/D169, doc 09 `/customers/{id}/wallet`)
 * ------------------------------------------------------------------ */

/** One `wallet_transactions` row; `amountPaise` is signed (credit > 0). */
export const customerWalletEntrySchema = z.object({
  id: z.uuid(),
  type: z.enum(WALLET_ENTRY_TYPES),
  amountPaise: z.number().int(),
  balanceAfterPaise: z.number().int(),
  refType: z.string().nullable(),
  refId: z.uuid().nullable(),
  reason: z.string().nullable(),
  actorId: z.uuid().nullable(),
  zoneId: z.uuid().nullable(),
  createdAt: z.string(),
});

export type CustomerWalletEntry = z.infer<typeof customerWalletEntrySchema>;

export const listWalletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListWalletQuery = z.infer<typeof listWalletQuerySchema>;

export const listWalletResponseSchema = z.object({
  data: z.object({
    balancePaise: z.number().int(),
    entries: z.array(customerWalletEntrySchema),
  }),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});

export type ListWalletResponse = z.infer<typeof listWalletResponseSchema>;

/* ------------------------------------------------------------------ *
 * Add/Edit forms (doc 22) — all-string values for react-hook-form;
 * `customerFormTo*` maps them to the API payloads above.
 * ------------------------------------------------------------------ */

export const customerFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: phoneSchema,
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  zoneId: z.string().min(1, 'Choose a zone'),
  address: z.string().trim().min(3, 'Address is required').max(240),
  area: z.string().trim().max(80),
  status: z.enum(CUSTOMER_STATUSES),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const customerEditFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  status: z.enum(CUSTOMER_STATUSES),
});

export type CustomerEditFormValues = z.infer<typeof customerEditFormSchema>;

/** Empty-string optionals become undefined in the create payload. */
export function customerFormToPayload(form: CustomerFormValues): CustomerCreateInput {
  const area = form.area.trim();
  return {
    name: form.name,
    phone: form.phone,
    email: form.email === '' ? undefined : form.email,
    zoneId: form.zoneId,
    address: form.address,
    area: area === '' ? undefined : area,
    status: form.status,
  };
}

/** Editing also allows clearing the email (null), like the zone form. */
export function customerEditFormToUpdate(form: CustomerEditFormValues): CustomerUpdateInput {
  return {
    name: form.name,
    email: form.email === '' ? null : form.email,
    status: form.status,
  };
}
