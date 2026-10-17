import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';

// Menu & Food Items (SA-2.4, ZA-2.3) request schemas: menu items, categories, bulk actions and the vendor item-change
// requests (R09, D119, D124-D127), shared with the menu screens and the OpenAPI document. DIETARY_TYPES and their
// labels are ported from Chittra Priya's branch; the approval workflow of that branch is replaced by change requests.

/** Database enum DietaryType (D119). EGG is set by admins only; the vendor app's `isVeg` maps to the other two (D127). */
export const DIETARY_TYPES = ['VEGETARIAN', 'NON_VEG', 'EGG'] as const;
export type DietaryType = (typeof DIETARY_TYPES)[number];
export const DIETARY_LABELS: Record<DietaryType, string> = {
  VEGETARIAN: 'Vegetarian',
  NON_VEG: 'Non-veg',
  EGG: 'Egg',
};
export const DIETARY_TONES: Record<DietaryType, 'success' | 'danger' | 'warning'> = {
  VEGETARIAN: 'success',
  NON_VEG: 'danger',
  EGG: 'warning',
};

/** An item belongs to exactly one vendor: a restaurant or a homemaker (doc 08 CHECK). */
export const MENU_VENDOR_KINDS = ['RESTAURANT', 'HOMEMAKER'] as const;
export type MenuVendorKind = (typeof MENU_VENDOR_KINDS)[number];

/**
 * Effective visibility (doc 44, D126): live = available AND in stock AND not admin-disabled. The filter and the row
 * badge use the first reason that applies, in this order: admin_disabled, vendor_off, out_of_stock, live.
 */
export const MENU_AVAILABILITY = ['live', 'out_of_stock', 'vendor_off', 'admin_disabled'] as const;
export type MenuAvailability = (typeof MENU_AVAILABILITY)[number];

export function menuAvailabilityOf(i: {
  adminDisabled: boolean;
  isAvailable: boolean;
  stock: number;
}): MenuAvailability {
  if (i.adminDisabled) return 'admin_disabled';
  if (!i.isAvailable) return 'vendor_off';
  if (i.stock <= 0) return 'out_of_stock';
  return 'live';
}

export const MENU_ITEM_NAME = { min: 2, max: 80 } as const;
export const MENU_ITEM_DESCRIPTION_MAX = 300;
export const CATEGORY_NAME = { min: 1, max: 60 } as const;
/** D124: a bulk request names at most this many items. */
export const MENU_BULK_MAX_IDS = 500;
/** Money is integer paise; at least 1 paise (doc 08). */
export const MENU_PRICE_MAX_PAISE = 10_000_000;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reason = text(3, 300);
const pricePaise = z
  .number()
  .int()
  .min(1, 'Price must be at least 1 paise')
  .max(MENU_PRICE_MAX_PAISE);
const stock = z.number().int().min(0).max(100_000);
const imageKey = text(1, 512);
const notEmpty = { message: 'Provide at least one field to update' };

/** `?zoneId=` is repeatable (doc 09); a single value arrives as a string. */
const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);
const boolParam = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
);
const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

// ---- menu items ---------------------------------------------------------------------------------------------------

/** POST /menu-items: the zone is the vendor's (no zoneId in the body); 409 while the vendor waits for a zone. */
export const menuItemCreateSchema = z
  .object({
    vendorKind: z.enum(MENU_VENDOR_KINDS),
    vendorId: z.uuid('Choose the vendor'),
    categoryId: z.uuid('Choose a category'),
    name: text(MENU_ITEM_NAME.min, MENU_ITEM_NAME.max),
    description: text(1, MENU_ITEM_DESCRIPTION_MAX).optional(),
    price: pricePaise,
    stock: stock.default(0),
    isAvailable: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    dietary: z.enum(DIETARY_TYPES).optional(),
    /** a confirmed MENU_IMAGE upload of this vendor (`/uploads/confirm`) */
    imageKey: imageKey.optional(),
  })
  .strict();
export type MenuItemCreateInput = z.infer<typeof menuItemCreateSchema>;

/**
 * PATCH /menu-items/{id}: admin edits apply at once (change requests are for vendor changes). Editing a vendor-owned
 * field sets admin_override_at (doc 44). `isAvailable` stays the vendor's (D126): the admin toggle is `adminDisabled`,
 * and disabling needs a reason that the vendor app receives (menu_item.admin_changed).
 */
export const menuItemUpdateSchema = z
  .object({
    categoryId: z.uuid().optional(),
    name: text(MENU_ITEM_NAME.min, MENU_ITEM_NAME.max).optional(),
    description: text(1, MENU_ITEM_DESCRIPTION_MAX).nullable().optional(),
    price: pricePaise.optional(),
    stock: stock.optional(),
    isFeatured: z.boolean().optional(),
    dietary: z.enum(DIETARY_TYPES).nullable().optional(),
    imageKey: imageKey.nullable().optional(),
    adminDisabled: z.boolean().optional(),
    reason: reason.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'reason'), notEmpty)
  .refine((v) => v.adminDisabled !== true || v.reason !== undefined, {
    message: 'A reason is required to disable an item',
    path: ['reason'],
  });
export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>;

export const menuItemIdParamsSchema = z.object({ id: z.uuid() });

export const MENU_SORT_FIELDS = ['createdAt', 'name', 'price', 'stock'] as const;

/** GET /menu-items: doc 09 list conventions plus the SA-2.4 filters. `q` matches the item or the vendor name. */
export const menuItemListQuerySchema = z.object({
  ...page,
  sort: sortSchema(MENU_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  q: text(1, 100).optional(),
  zoneId: zoneIdsParam,
  vendorKind: z.enum(MENU_VENDOR_KINDS).optional(),
  vendorId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  availability: z.enum(MENU_AVAILABILITY).optional(),
  featured: boolParam,
  dietary: z.enum(DIETARY_TYPES).optional(),
});
export type MenuItemListQuery = z.infer<typeof menuItemListQuerySchema>;

// ---- bulk (D124) --------------------------------------------------------------------------------------------------

/** Price adjustments: a signed percentage (two decimals) or a signed amount in paise; results round half-up. */
export const MENU_PRICE_MODES = ['percent', 'amount'] as const;
export type MenuPriceMode = (typeof MENU_PRICE_MODES)[number];

const bulkIds = z
  .array(z.uuid())
  .min(1, 'Select at least one item')
  .max(MENU_BULK_MAX_IDS)
  .refine((ids) => new Set(ids).size === ids.length, 'Each item once');

/**
 * POST /menu-items/bulk/preview and /menu-items/bulk. All-or-nothing (D124): any id outside the caller's zones (or
 * missing) rejects the whole request with 404 and nothing changes.
 */
export const menuBulkSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('availability'),
      ids: bulkIds,
      adminDisabled: z.boolean(),
      reason: reason.optional(),
    })
    .strict()
    .refine((v) => !v.adminDisabled || v.reason !== undefined, {
      message: 'A reason is required to disable items',
      path: ['reason'],
    }),
  z.object({ action: z.literal('category'), ids: bulkIds, categoryId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('price'),
      ids: bulkIds,
      mode: z.enum(MENU_PRICE_MODES),
      value: z.number(),
    })
    .strict()
    .refine(
      (v) =>
        v.mode === 'percent'
          ? v.value >= -90 &&
            v.value <= 500 &&
            Math.abs(v.value * 100 - Math.round(v.value * 100)) < 1e-6
          : Number.isInteger(v.value) && Math.abs(v.value) <= MENU_PRICE_MAX_PAISE,
      { message: 'percent: -90 to 500 with two decimals; amount: whole paise', path: ['value'] },
    )
    .refine((v) => v.value !== 0, { message: 'The change cannot be zero', path: ['value'] }),
]);
export type MenuBulkInput = z.infer<typeof menuBulkSchema>;
export type MenuBulkAction = MenuBulkInput['action'];

// ---- categories ---------------------------------------------------------------------------------------------------

export const CATEGORY_SORT_FIELDS = ['sortOrder', 'name', 'createdAt'] as const;

/** GET /categories: global categories plus the zone categories of the caller's view scope. */
export const categoryListQuerySchema = z.object({
  ...page,
  sort: sortSchema(CATEGORY_SORT_FIELDS, { field: 'sortOrder', direction: 'asc' }),
  q: text(1, 60).optional(),
  zoneId: zoneIdsParam,
  /** default: both; `global` = only zone_id null, `zone` = only zone categories */
  kind: z.enum(['global', 'zone']).optional(),
});
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;

/** POST /categories: `zoneId: null` is a global category (Super Admin only, a Zonal Admin gets 403). */
export const categoryCreateSchema = z
  .object({
    zoneId: z.uuid().nullable(),
    name: text(CATEGORY_NAME.min, CATEGORY_NAME.max),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

/** PATCH /categories/{id}: the zone of a category never changes. */
export const categoryUpdateSchema = z
  .object({
    name: text(CATEGORY_NAME.min, CATEGORY_NAME.max).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, notEmpty);
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export const categoryIdParamsSchema = z.object({ id: z.uuid() });

// ---- change requests (R09) ----------------------------------------------------------------------------------------

export const MENU_CHANGE_KINDS = ['CREATE', 'UPDATE', 'DELETE'] as const;
export type MenuChangeKind = (typeof MENU_CHANGE_KINDS)[number];
export const MENU_CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type MenuChangeStatus = (typeof MENU_CHANGE_STATUSES)[number];

/** D127 (1): the vendor changes that wait for approval; everything else a vendor sends (stock, availability) applies at once. */
export const MENU_APPROVAL_FIELDS = [
  'name',
  'description',
  'price',
  'categoryId',
  'dietary',
  'imageKey',
] as const;
export type MenuApprovalField = (typeof MENU_APPROVAL_FIELDS)[number];
export const MENU_IMMEDIATE_FIELDS = ['stock', 'isAvailable'] as const;
export type MenuImmediateField = (typeof MENU_IMMEDIATE_FIELDS)[number];

/**
 * What a change request proposes (`proposed_json`), in menu_items terms: the intake handler maps the vendor app's
 * MenuItemUpsert first (pricePaise -> price, category name -> categoryId in the zone then global, unknown -> 422,
 * isVeg -> VEGETARIAN / NON_VEG). Stock and availability are present on a CREATE only (the item does not exist yet).
 */
export const menuChangeProposalSchema = z
  .object({
    name: text(MENU_ITEM_NAME.min, MENU_ITEM_NAME.max).optional(),
    description: text(1, MENU_ITEM_DESCRIPTION_MAX).nullable().optional(),
    price: pricePaise.optional(),
    categoryId: z.uuid().optional(),
    dietary: z.enum(DIETARY_TYPES).nullable().optional(),
    imageKey: imageKey.nullable().optional(),
    stock: stock.optional(),
    isAvailable: z.boolean().optional(),
  })
  .strict();
export type MenuChangeProposal = z.infer<typeof menuChangeProposalSchema>;

export const CHANGE_REQUEST_SORT_FIELDS = ['createdAt', 'decidedAt'] as const;

/** GET /menu-items/change-requests: newest first; default status PENDING (the review queue). */
export const changeRequestListQuerySchema = z.object({
  ...page,
  sort: sortSchema(CHANGE_REQUEST_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  zoneId: zoneIdsParam,
  status: z.enum(MENU_CHANGE_STATUSES).default('PENDING'),
  kind: z.enum(MENU_CHANGE_KINDS).optional(),
  vendorKind: z.enum(MENU_VENDOR_KINDS).optional(),
  vendorId: z.uuid().optional(),
  menuItemId: z.uuid().optional(),
});
export type ChangeRequestListQuery = z.infer<typeof changeRequestListQuerySchema>;

export const changeRequestIdParamsSchema = z.object({ id: z.uuid() });

/** POST /menu-items/change-requests/{id}/approve: `version` is the request's (409 when it moved on). */
export const changeRequestApproveSchema = z.object({ version: z.number().int().min(1) }).strict();
export type ChangeRequestApproveInput = z.infer<typeof changeRequestApproveSchema>;

/** POST /menu-items/change-requests/{id}/reject: the reason goes to the vendor (menu_item.change_decided). */
export const changeRequestRejectSchema = z
  .object({ version: z.number().int().min(1), reason })
  .strict();
export type ChangeRequestRejectInput = z.infer<typeof changeRequestRejectSchema>;
