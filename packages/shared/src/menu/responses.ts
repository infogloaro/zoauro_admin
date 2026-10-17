import { z } from 'zod';
import { pageMetaSchema } from '../pagination';
import {
  DIETARY_TYPES,
  MENU_APPROVAL_FIELDS,
  MENU_AVAILABILITY,
  MENU_CHANGE_KINDS,
  MENU_CHANGE_STATUSES,
  MENU_VENDOR_KINDS,
  menuChangeProposalSchema,
} from './schemas';

// Menu & Food Items responses (SA-2.4, R09, D119, D126), shared with the menu screens and the OpenAPI document.

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const menuZoneRefSchema = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
export const menuVendorRefSchema = z.object({
  kind: z.enum(MENU_VENDOR_KINDS),
  id: z.uuid(),
  name: z.string(),
});
export const menuCategoryRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** zone_id null */
  global: z.boolean(),
});
export const menuUserRefSchema = z.object({ id: z.uuid(), name: z.string() });

/** A row of GET /menu-items. */
export const menuItemListItemSchema = z.object({
  id: z.uuid(),
  zone: menuZoneRefSchema,
  vendor: menuVendorRefSchema,
  category: menuCategoryRefSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** paise */
  price: z.number().int(),
  stock: z.number().int(),
  /** the vendor's switch (doc 44) */
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  /** the admin's switch (D126) */
  adminDisabled: z.boolean(),
  availability: z.enum(MENU_AVAILABILITY),
  dietary: z.enum(DIETARY_TYPES).nullable(),
  hasImage: z.boolean(),
  /** a vendor change waits for review (R09) */
  hasPendingChange: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
});
export type MenuItemListItem = z.infer<typeof menuItemListItemSchema>;

/** Counts within the effective scope and the current filters except `availability` (list tabs). */
export const menuCountsSchema = z.object({
  total: count,
  live: count,
  outOfStock: count,
  vendorOff: count,
  adminDisabled: count,
  pendingChanges: count,
});
export type MenuCounts = z.infer<typeof menuCountsSchema>;

export const menuItemListResponseSchema = z.object({
  data: z.array(menuItemListItemSchema),
  meta: pageMetaSchema.extend({ counts: menuCountsSchema }),
});
export type MenuItemListResponse = z.infer<typeof menuItemListResponseSchema>;

/** GET /menu-items/{id} and every item write. */
export const menuItemDetailSchema = menuItemListItemSchema.extend({
  /** set when an admin edited a vendor-owned field (doc 44) */
  adminOverrideAt: iso.nullable(),
  /** the open change request, if any */
  pendingChangeRequestId: z.uuid().nullable(),
});
export type MenuItemDetail = z.infer<typeof menuItemDetailSchema>;

// ---- bulk (D124) --------------------------------------------------------------------------------------------------

export const MENU_BULK_SKIP_REASONS = [
  'UNCHANGED',
  'PRICE_BELOW_MINIMUM',
  'PRICE_ABOVE_MAXIMUM',
  'CATEGORY_OTHER_ZONE',
] as const;
export type MenuBulkSkipReason = (typeof MENU_BULK_SKIP_REASONS)[number];

const bulkValue = z.union([z.number(), z.boolean(), z.string()]);

/** POST /menu-items/bulk/preview: what would change, nothing written. */
export const menuBulkPreviewSchema = z.object({
  action: z.enum(['availability', 'category', 'price']),
  changes: z.array(
    z.object({ id: z.uuid(), name: z.string(), before: bulkValue, after: bulkValue }),
  ),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.enum(MENU_BULK_SKIP_REASONS) })),
});
export type MenuBulkPreview = z.infer<typeof menuBulkPreviewSchema>;

/** POST /menu-items/bulk: the same calculation, applied in one transaction with one menu_item.bulk_updated row. */
export const menuBulkResultSchema = menuBulkPreviewSchema.extend({ updated: count });
export type MenuBulkResult = z.infer<typeof menuBulkResultSchema>;

// ---- categories ---------------------------------------------------------------------------------------------------

export const categorySchema = z.object({
  id: z.uuid(),
  /** null = global (Super Admin only) */
  zone: menuZoneRefSchema.nullable(),
  name: z.string(),
  sortOrder: z.number().int(),
  /** live (not deleted) items in the category, within the caller's view scope */
  itemCount: count,
  createdAt: iso,
  updatedAt: iso,
});
export type Category = z.infer<typeof categorySchema>;

export const categoryListResponseSchema = z.object({
  data: z.array(categorySchema),
  meta: pageMetaSchema,
});
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;

// ---- change requests (R09) ----------------------------------------------------------------------------------------

/** A row of GET /menu-items/change-requests. */
export const changeRequestListItemSchema = z.object({
  id: z.uuid(),
  zone: menuZoneRefSchema,
  vendor: menuVendorRefSchema,
  /** null until a CREATE is approved */
  menuItem: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** the proposed name, or the item's name for a DELETE */
  name: z.string(),
  kind: z.enum(MENU_CHANGE_KINDS),
  status: z.enum(MENU_CHANGE_STATUSES),
  /** fields that wait for approval in this request */
  fields: z.array(z.enum(MENU_APPROVAL_FIELDS)),
  decidedBy: menuUserRefSchema.nullable(),
  decidedAt: iso.nullable(),
  decisionReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: iso,
});
export type ChangeRequestListItem = z.infer<typeof changeRequestListItemSchema>;

export const changeRequestListResponseSchema = z.object({
  data: z.array(changeRequestListItemSchema),
  meta: pageMetaSchema,
});
export type ChangeRequestListResponse = z.infer<typeof changeRequestListResponseSchema>;

const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** GET /menu-items/change-requests/{id}: base (when submitted), live (now) and proposed, per field. */
export const changeRequestDetailSchema = changeRequestListItemSchema.extend({
  proposed: menuChangeProposalSchema,
  base: menuChangeProposalSchema.nullable(),
  /** the item as it is now; null for a CREATE that is not approved */
  live: menuChangeProposalSchema.nullable(),
  changes: z.array(
    z.object({
      field: z.enum(MENU_APPROVAL_FIELDS),
      base: fieldValue,
      live: fieldValue,
      proposed: fieldValue,
      /** live differs from base: an admin changed the field after the vendor submitted */
      liveChanged: z.boolean(),
    }),
  ),
});
export type ChangeRequestDetail = z.infer<typeof changeRequestDetailSchema>;
