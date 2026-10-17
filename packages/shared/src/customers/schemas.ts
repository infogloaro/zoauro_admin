import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';
import { normaliseIndianMobile } from '../phone';

// M09 Customers request schemas (doc 08 customers, doc 09, D14, D25, D26, D28, D63), shared with the customer screens
// and the OpenAPI document.

/** Database enum CustomerStatus. */
export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Registration source: doc 08's Figma set plus IMPORT from the v2.0 columns (owner, 2026-10-17). */
export const CUSTOMER_SOURCES = ['APP', 'ADMIN', 'REFERRAL', 'OTHER', 'IMPORT'] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

export const CUSTOMER_NAME = { min: 2, max: 80 } as const;
export const BLOCK_REASON = { min: 5, max: 300 } as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const e164 = normaliseIndianMobile(v);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
      return z.NEVER;
    }
    return e164;
  });
const email = z.email('Enter a valid email').max(254);

/** The first address of an admin-created customer: its zone makes the customer visible there (D25). */
export const customerAddressInputSchema = z
  .object({
    zoneId: z.uuid('Choose a zone'),
    label: text(1, 40).optional(),
    address: text(3, 240),
    area: text(1, 80).optional(),
    pincode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, 'must be a 6-digit pincode')
      .optional(),
  })
  .strict();

/** POST /customers (D28): source ADMIN, unique phone, no login credentials. */
export const customerCreateSchema = z
  .object({
    name: text(CUSTOMER_NAME.min, CUSTOMER_NAME.max),
    phone,
    email: email.optional(),
    address: customerAddressInputSchema,
  })
  .strict();
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

/** PATCH /customers/{id}: the profile copy (doc 44); status changes only by block/unblock. */
export const customerUpdateSchema = z
  .object({
    name: text(CUSTOMER_NAME.min, CUSTOMER_NAME.max).optional(),
    phone: phone.optional(),
    email: email.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

/** POST /customers/{id}/block: a reason is kept in the audit trail. */
export const customerBlockSchema = z
  .object({ reason: text(BLOCK_REASON.min, BLOCK_REASON.max) })
  .strict();
export type CustomerBlockInput = z.infer<typeof customerBlockSchema>;

/** POST /customers/{id}/unblock */
export const customerUnblockSchema = z
  .object({ reason: text(BLOCK_REASON.min, BLOCK_REASON.max).optional() })
  .strict();
export type CustomerUnblockInput = z.infer<typeof customerUnblockSchema>;

export const customerIdParamsSchema = z.object({ id: z.uuid() });

/** `?zoneId=` is repeatable (doc 09); a single value arrives as a string. */
const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);

export const CUSTOMER_SORT_FIELDS = ['createdAt', 'name'] as const;

/** GET /customers: `q` matches name, phone or email; zone = an address or an order there (D25). */
export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(CUSTOMER_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  q: text(1, 100).optional(),
  zoneId: zoneIdsParam,
  status: z.enum(CUSTOMER_STATUSES).optional(),
  source: z.enum(CUSTOMER_SOURCES).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
