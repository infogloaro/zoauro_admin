import { z } from 'zod';
import { DIETARY_TYPES, MENU_APPROVAL_STATUSES, MENU_BULK_ACTIONS } from './enums';

/**
 * Menu & Food Items contracts (task: Menu & Food Items screen; doc 09
 * `/menu-items`, doc 34 SA-2.4). One item belongs to exactly one provider —
 * restaurant, home-food maker or hotel (dining menus) — via
 * vendor_type + vendor_id. Items enter as PENDING and move through the
 * approval workflow; edits by an admin do not silently re-approve.
 */

/** Owner kinds for an item (camel input, mapped to `VendorType` server-side). */
export const MENU_OWNER_KINDS = ['restaurant', 'homemaker', 'hotel'] as const;
export type MenuOwnerKind = (typeof MENU_OWNER_KINDS)[number];

const itemNameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);
/** Money is integer paise (AGENTS.md). */
const priceSchema = z.number().int().min(1, 'Price must be at least ₹1').max(10_000_000);

export const menuItemCreateSchema = z.object({
  zoneId: z.uuid('Choose a zone'),
  vendorType: z.enum(MENU_OWNER_KINDS),
  vendorId: z.uuid('Choose the provider'),
  name: itemNameSchema,
  description: z.string().trim().max(300).optional(),
  category: z.string().trim().max(60).optional(),
  price: priceSchema,
  dietary: z.enum(DIETARY_TYPES),
});

export type MenuItemCreateInput = z.infer<typeof menuItemCreateSchema>;

/** PATCH /menu-items/{id} — owner and zone are fixed; approval stays as-is. */
export const menuItemUpdateSchema = z
  .object({
    name: itemNameSchema.optional(),
    description: z.string().trim().max(300).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    price: priceSchema.optional(),
    dietary: z.enum(DIETARY_TYPES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

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

/** POST /menu-items/bulk — review in bulk within the permitted zone scope. */
export const menuItemBulkSchema = z.object({
  ids: z.array(z.uuid()).min(1, 'Select at least one item').max(100),
  action: z.enum(MENU_BULK_ACTIONS),
  reason: z.string().trim().max(300).optional(),
});

export type MenuItemBulkInput = z.infer<typeof menuItemBulkSchema>;

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
  dietary: z.enum(DIETARY_TYPES).optional(),
  category: z.string().trim().min(1).max(60).optional(),
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
    dietary: form.dietary,
  };
}

/**
 * Every editable field the form supports (owner and zone are immutable, and
 * approval status only moves through its own endpoint). Rupees → paise here,
 * at the same edge as the create payload.
 */
export function menuItemFormToUpdate(form: MenuItemFormValues): MenuItemUpdateInput {
  return {
    name: form.name,
    description: form.description.trim() === '' ? null : form.description.trim(),
    category: form.category.trim() === '' ? null : form.category.trim(),
    price: Number(form.price) * 100,
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
