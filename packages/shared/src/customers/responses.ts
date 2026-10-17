import { z } from 'zod';
import { pageMetaSchema } from '../pagination';
import { CUSTOMER_STATUSES } from './schemas';

// M09 Customers responses (doc 09, D25, D26). Phone and email are masked everywhere except GET /customers/{id}/reveal
// (audited). Order count, total spent and the order list are limited to the caller's zones (D25); so are addresses.

const iso = z.iso.datetime();
const count = z.number().int().min(0);
export const customerZoneRefSchema = z.object({ id: z.uuid(), name: z.string(), code: z.string() });

/** A row of GET /customers. */
export const customerListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** masked (D26) */
  phone: z.string(),
  /** masked (D26) */
  email: z.string().nullable(),
  status: z.enum(CUSTOMER_STATUSES),
  /** registration source as stored (APP, ADMIN, REFERRAL, OTHER, IMPORT; null for old rows) */
  source: z.string().nullable(),
  /** the zones of the caller's scope where the customer has an address or an order (D25) */
  zones: z.array(customerZoneRefSchema),
  /** within the caller's scope (D25) */
  orderCount: count,
  /** paise, delivered orders within the caller's scope (D25) */
  totalSpentPaise: count,
  lastOrderAt: iso.nullable(),
  createdAt: iso,
});
export type CustomerListItem = z.infer<typeof customerListItemSchema>;

export const customerCountsSchema = z.object({
  total: count,
  active: count,
  inactive: count,
  blocked: count,
});

export const customerListResponseSchema = z.object({
  data: z.array(customerListItemSchema),
  meta: pageMetaSchema.extend({ counts: customerCountsSchema }),
});
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;

export const customerAddressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  address: z.string(),
  area: z.string().nullable(),
  pincode: z.string().nullable(),
  zone: customerZoneRefSchema.nullable(),
  isDefault: z.boolean(),
});

export const customerOrderRowSchema = z.object({
  id: z.uuid(),
  orderNo: z.string(),
  zone: customerZoneRefSchema,
  status: z.string(),
  totalPaise: z.number().int(),
  placedAt: iso,
});

/** GET /customers/{id} and every customer write. */
export const customerDetailSchema = customerListItemSchema.extend({
  walletBalancePaise: z.number().int(),
  updatedAt: iso,
  addresses: z.array(customerAddressSchema),
  /** the 10 latest orders within the caller's scope */
  recentOrders: z.array(customerOrderRowSchema),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

/** GET /customers/{id}/reveal (D26): the unmasked contact, audited and rate-limited. */
export const customerContactSchema = z.object({ phone: z.string(), email: z.string().nullable() });
export type CustomerContact = z.infer<typeof customerContactSchema>;
