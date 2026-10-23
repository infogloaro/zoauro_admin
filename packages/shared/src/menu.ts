import { z } from 'zod';
import {
  DIETARY_TYPES,
  MENU_APPROVAL_STATUSES,
  MENU_AVAILABILITY_FILTERS,
  MENU_BULK_ACTIONS,
  MENU_BULK_VALUE_ACTIONS,
  MENU_CHANGE_DECISIONS,
  MENU_CHANGE_KINDS,
  MENU_CHANGE_STATUSES,
} from './enums';

/**
 * Menu & Food Items contracts (task: Menu & Food Items screen; doc 09
 * `/menu-items`, doc 34 SA-2.4). One item belongs to exactly one provider —
 * restaurant, home-food maker or hotel (dining menus) — via
 * vendor_type + vendor_id. Items enter as PENDING and move through the
 * approval workflow; edits by an admin do not silently re-approve.
 *
 * D119 (owner 2026-10-17): the item keeps the documented shape — stock,
 * availability, featured, image and an `admin_disabled` toggle (D126: the
 * admin toggle writes `admin_disabled`, never the vendor's `is_available`;
 * a vendor-owned field edited by an admin stamps `admin_override_at`,
 * doc 44).
 */

/** Owner kinds for an item (camel input, mapped to `VendorType` server-side). */
export const MENU_OWNER_KINDS = ['restaurant', 'homemaker', 'hotel'] as const;
export type MenuOwnerKind = (typeof MENU_OWNER_KINDS)[number];

const itemNameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);
export { itemNameSchema };
/** Money is integer paise (AGENTS.md). */
const priceSchema = z.number().int().min(1, 'Price must be at least ₹1').max(10_000_000);

/**
 * Stock is nullable: `null` = not tracked (treated as in stock, so existing
 * items stay live), `0` = out of stock. Documented deviation from upstream's
 * non-null default (doc 32 row) — no backfill value was decided.
 */
export const stockSchema = z.number().int().min(0).max(1_000_000);

/** Image key of an upload (MENU_IMAGE purpose); never a URL. */
export const imageKeySchema = z.string().trim().min(1).max(512);

export const menuItemCreateSchema = z.object({
  zoneId: z.uuid('Choose a zone'),
  vendorType: z.enum(MENU_OWNER_KINDS),
  vendorId: z.uuid('Choose the provider'),
  name: itemNameSchema,
  description: z.string().trim().max(300).optional(),
  category: z.string().trim().max(60).optional(),
  price: priceSchema,
  stock: stockSchema.nullable().optional(),
  isAvailable: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  imageKey: imageKeySchema.nullable().optional(),
  dietary: z.enum(DIETARY_TYPES),
});

export type MenuItemCreateInput = z.infer<typeof menuItemCreateSchema>;

/**
 * PATCH /menu-items/{id} — owner and zone are fixed; approval stays as-is.
 * `adminDisabled` (+ `reason` when disabling) is the admin toggle (D126);
 * setting any vendor-owned field stamps `admin_override_at` (doc 44).
 */
export const menuItemUpdateSchema = z
  .object({
    name: itemNameSchema.optional(),
    description: z.string().trim().max(300).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    price: priceSchema.optional(),
    stock: stockSchema.nullable().optional(),
    isAvailable: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    imageKey: imageKeySchema.nullable().optional(),
    dietary: z.enum(DIETARY_TYPES).optional(),
    adminDisabled: z.boolean().optional(),
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' })
  .refine((v) => v.adminDisabled !== true || v.reason !== undefined, {
    error: 'A reason is required when disabling an item',
    path: ['reason'],
  });

export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>;

/** POST /menu-items/{id}/approval — reject requires a reason. */
export const menuItemApprovalSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'ARCHIVED']),
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => v.decision !== 'REJECTED' || v.reason !== undefined, {
    error: 'A reason is required when rejecting',
    path: ['reason'],
  });

export type MenuItemApprovalInput = z.infer<typeof menuItemApprovalSchema>;

/* ------------------------------------------------------------------ *
 * Bulk actions (doc 09: /bulk/preview + /bulk, D124 all-or-nothing)
 * ------------------------------------------------------------------ */

const bulkIdsSchema = z.array(z.uuid()).min(1, 'Select at least one item').max(500);

const bulkApprovalShape = {
  action: z.enum(MENU_BULK_ACTIONS),
  ids: bulkIdsSchema,
  reason: z.string().trim().max(300).optional(),
};

const bulkValueShape = {
  ids: bulkIdsSchema,
  reason: z.string().trim().max(300).optional(),
};

/** Signed percent to apply to each price; the result rounds half-up to whole paise. */
const pricePercentSchema = z.number().refine((v) => Number.isFinite(v) && v >= -99 && v <= 1000, {
  error: 'Percent must be between -99 and 1000',
});

/**
 * POST /menu-items/bulk — approval actions stay under `menu:edit`? No:
 * APPROVE/ARCHIVE keep `menu:status`; `availability | category | price`
 * run under `menu:edit` (doc 09 row). Exactly one price mode per request.
 */
export const menuItemBulkSchema = z.discriminatedUnion('action', [
  z.object(bulkApprovalShape),
  z.object({
    action: z.literal('availability'),
    ids: bulkIdsSchema,
    available: z.boolean(),
    reason: bulkValueShape.reason,
  }),
  z.object({
    action: z.literal('category'),
    ids: bulkIdsSchema,
    category: z.string().trim().max(60).nullable(),
    reason: bulkValueShape.reason,
  }),
  z.object({
    action: z.literal('price'),
    ids: bulkIdsSchema,
    percent: pricePercentSchema.optional(),
    amountPaise: z.number().int().min(1).max(10_000_000).optional(),
    reason: bulkValueShape.reason,
  }),
]);

export type MenuItemBulkInput = z.infer<typeof menuItemBulkSchema>;

/** POST /menu-items/bulk/preview — same shape as /bulk, value actions only, writes nothing. */
export const menuItemBulkPreviewSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('availability'),
    ids: bulkIdsSchema,
    available: z.boolean(),
    reason: bulkValueShape.reason,
  }),
  z.object({
    action: z.literal('category'),
    ids: bulkIdsSchema,
    category: z.string().trim().max(60).nullable(),
    reason: bulkValueShape.reason,
  }),
  z.object({
    action: z.literal('price'),
    ids: bulkIdsSchema,
    percent: pricePercentSchema.optional(),
    amountPaise: z.number().int().min(1).max(10_000_000).optional(),
    reason: bulkValueShape.reason,
  }),
]);

export type MenuItemBulkPreviewInput = z.infer<typeof menuItemBulkPreviewSchema>;

/** One previewed row: before → after for the fields the action touches. */
export const menuBulkPreviewRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  before: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  after: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type MenuBulkPreviewRow = z.infer<typeof menuBulkPreviewRowSchema>;

export const menuBulkPreviewResponseSchema = z.object({
  data: z.object({
    action: z.enum(MENU_BULK_VALUE_ACTIONS),
    total: z.number().int(),
    rows: z.array(menuBulkPreviewRowSchema),
  }),
});
export type MenuBulkPreviewResponse = z.infer<typeof menuBulkPreviewResponseSchema>;

/* ------------------------------------------------------------------ *
 * List query
 * ------------------------------------------------------------------ */

export const MENU_SORT_FIELDS = ['createdAt', 'name', 'price'] as const;

export const listMenuItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(MENU_APPROVAL_STATUSES).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  vendorType: z.enum(MENU_OWNER_KINDS).optional(),
  vendorId: z.uuid().optional(),
  dietary: z.enum(DIETARY_TYPES).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  availability: z.enum(MENU_AVAILABILITY_FILTERS).optional(),
  featured: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt|name|price)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});

export type ListMenuItemsQuery = z.infer<typeof listMenuItemsQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09). */
export function requestedMenuZoneIds(query: ListMenuItemsQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export const menuZoneRefSchema = z.object({ id: z.uuid(), name: z.string(), city: z.string() });

export const menuItemSchema = z.object({
  kind: z.literal('menu-item'),
  id: z.uuid(),
  zoneId: z.uuid(),
  zone: menuZoneRefSchema,
  vendorType: z.enum(MENU_OWNER_KINDS),
  vendorId: z.uuid(),
  vendorName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  price: z.number().int(),
  stock: z.number().int().nullable(),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  imageKey: z.string().nullable(),
  adminDisabled: z.boolean(),
  adminOverrideAt: z.string().nullable(),
  /** D126: live = available && in stock (or untracked) && not admin-disabled. */
  live: z.boolean(),
  dietary: z.enum(DIETARY_TYPES),
  approvalStatus: z.enum(MENU_APPROVAL_STATUSES),
  rejectionReason: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MenuItem = z.infer<typeof menuItemSchema>;

export const menuCountsSchema = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  approved: z.number().int(),
  rejected: z.number().int(),
  archived: z.number().int(),
});
export type MenuCounts = z.infer<typeof menuCountsSchema>;

export const menuFacetsSchema = z.object({
  categories: z.array(z.string()),
  zones: z.array(menuZoneRefSchema),
});
export type MenuFacets = z.infer<typeof menuFacetsSchema>;

export const listMenuItemsResponseSchema = z.object({
  data: z.array(menuItemSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: menuCountsSchema,
    facets: menuFacetsSchema,
  }),
});
export type ListMenuItemsResponse = z.infer<typeof listMenuItemsResponseSchema>;

/** GET /menu-items/menus — the "All Menus" tab: categories with item counts. */
export const menuAggregateSchema = z.object({
  category: z.string(),
  count: z.number().int(),
  pending: z.number().int(),
  zones: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type MenuAggregate = z.infer<typeof menuAggregateSchema>;

export const listMenusResponseSchema = z.object({
  data: z.array(menuAggregateSchema),
  meta: z.object({
    total: z.number().int(),
    counts: menuCountsSchema,
  }),
});
export type ListMenusResponse = z.infer<typeof listMenusResponseSchema>;

/* ------------------------------------------------------------------ *
 * Add/Edit form (react-hook-form, all-string values)
 * ------------------------------------------------------------------ */

export const menuItemFormSchema = z.object({
  vendorType: z.enum(MENU_OWNER_KINDS),
  vendorId: z.string().min(1, 'Choose the provider'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  description: z.string().trim().max(300),
  category: z.string().trim().max(60),
  price: z
    .string()
    .refine((v) => /^\d{1,7}$/.test(v) && Number(v) >= 1, 'Enter a price of ₹1 or more'),
  stock: z
    .string()
    .refine((v) => v === '' || /^\d{1,6}$/.test(v), 'Stock must be a whole number or empty'),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  dietary: z.enum(DIETARY_TYPES),
});

export type MenuItemFormValues = z.infer<typeof menuItemFormSchema>;

/** Empty-string optionals become undefined; rupees → paise at the edge. */
export function menuItemFormToPayload(
  form: MenuItemFormValues,
  zoneId: string,
): MenuItemCreateInput {
  return {
    zoneId,
    vendorType: form.vendorType,
    vendorId: form.vendorId,
    name: form.name,
    description: form.description.trim() === '' ? undefined : form.description.trim(),
    category: form.category.trim() === '' ? undefined : form.category.trim(),
    price: Number(form.price) * 100,
    stock: form.stock.trim() === '' ? undefined : Number(form.stock),
    isAvailable: form.isAvailable,
    isFeatured: form.isFeatured,
    dietary: form.dietary,
  };
}

/**
 * Every editable field the form supports (owner and zone are immutable, and
 * approval status only moves through its own endpoint). Rupees → paise here,
 * at the same edge as the create payload. An empty stock clears tracking
 * (nullable column).
 */
export function menuItemFormToUpdate(form: MenuItemFormValues): MenuItemUpdateInput {
  return {
    name: form.name,
    description: form.description.trim() === '' ? null : form.description.trim(),
    category: form.category.trim() === '' ? null : form.category.trim(),
    price: Number(form.price) * 100,
    stock: form.stock.trim() === '' ? null : Number(form.stock),
    isAvailable: form.isAvailable,
    isFeatured: form.isFeatured,
    dietary: form.dietary,
  };
}

/** Display labels shared by the screen, table and API meta (doc 19). */
export const DIETARY_LABELS: Record<(typeof DIETARY_TYPES)[number], string> = {
  VEGETARIAN: 'Vegetarian',
  NON_VEG: 'Non-veg',
  EGG: 'Egg',
};

export const MENU_STATUS_LABELS: Record<(typeof MENU_APPROVAL_STATUSES)[number], string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

/** Chip tones for the status and dietary columns. */
export const MENU_STATUS_TONES: Record<
  (typeof MENU_APPROVAL_STATUSES)[number],
  'success' | 'warning' | 'danger' | 'info'
> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  ARCHIVED: 'info',
};

/* ------------------------------------------------------------------ *
 * Vendor menu change requests (R09, D119/D125/D127) — declared after the
 * response schemas they extend.
 * ------------------------------------------------------------------ */

export const menuItemChangeRequestSchema = z.object({
  kind: z.literal('menu-change-request'),
  id: z.uuid(),
  zoneId: z.uuid(),
  zone: menuZoneRefSchema,
  menuItemId: z.uuid().nullable(),
  itemName: z.string().nullable(),
  vendorType: z.enum(MENU_OWNER_KINDS),
  vendorId: z.uuid(),
  vendorName: z.string(),
  changeKind: z.enum(MENU_CHANGE_KINDS),
  status: z.enum(MENU_CHANGE_STATUSES),
  proposed: z.record(z.string(), z.unknown()),
  base: z.record(z.string(), z.unknown()).nullable(),
  source: z.string(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MenuItemChangeRequest = z.infer<typeof menuItemChangeRequestSchema>;

/** Per-field comparison for the detail view: base → live → proposed. */
export const menuChangeFieldSchema = z.object({
  field: z.string(),
  base: z.string().nullable(),
  live: z.string().nullable(),
  proposed: z.string().nullable(),
  changed: z.boolean(),
});
export type MenuChangeField = z.infer<typeof menuChangeFieldSchema>;

export const menuItemChangeRequestDetailSchema = menuItemChangeRequestSchema.extend({
  live: menuItemSchema.nullable(),
  fields: z.array(menuChangeFieldSchema),
});
export type MenuItemChangeRequestDetail = z.infer<typeof menuItemChangeRequestDetailSchema>;

export const listMenuItemChangeRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(MENU_CHANGE_STATUSES).default('PENDING'),
  changeKind: z.enum(MENU_CHANGE_KINDS).optional(),
  vendorType: z.enum(MENU_OWNER_KINDS).optional(),
  vendorId: z.uuid().optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});
export type ListMenuItemChangeRequestsQuery = z.infer<typeof listMenuItemChangeRequestsQuerySchema>;

export const listMenuItemChangeRequestsResponseSchema = z.object({
  data: z.array(menuItemChangeRequestSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: z.object({
      pending: z.number().int(),
      approved: z.number().int(),
      rejected: z.number().int(),
      superseded: z.number().int(),
    }),
  }),
});
export type ListMenuItemChangeRequestsResponse = z.infer<
  typeof listMenuItemChangeRequestsResponseSchema
>;

/** POST /menu-items/change-requests/{id}/approve — optimistic version check. */
export const menuItemChangeApproveSchema = z.object({
  version: z.number().int().min(1),
});
export type MenuItemChangeApproveInput = z.infer<typeof menuItemChangeApproveSchema>;

/** POST /menu-items/change-requests/{id}/reject — reason required. */
export const menuItemChangeRejectSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().trim().min(1).max(300),
});
export type MenuItemChangeRejectInput = z.infer<typeof menuItemChangeRejectSchema>;

export const MENU_CHANGE_DECISION_LABELS: Record<(typeof MENU_CHANGE_DECISIONS)[number], string> = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const MENU_CHANGE_STATUS_LABELS: Record<(typeof MENU_CHANGE_STATUSES)[number], string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
};

/** Tone map for change-request status chips. */
export const MENU_CHANGE_STATUS_TONES: Record<
  (typeof MENU_CHANGE_STATUSES)[number],
  'success' | 'warning' | 'danger' | 'info'
> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'info',
};
