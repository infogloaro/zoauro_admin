import { z } from 'zod';

// M18 Global Search (doc 09 "GET /search?q=", D32, doc 34 SA-7.5, doc 36 section 1). One box across orders, customers,
// vendors (restaurants, homemakers) and delivery partners. Every group is filtered by its own module's view permission
// and the member's zone scope, exactly like that module's list; phones are masked as in every list (D26).

/** The entity groups, in the order the header shows them. */
export const SEARCH_ENTITY_TYPES = [
  'order',
  'customer',
  'restaurant',
  'homemaker',
  'deliveryPartner',
] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** Rows per group in the header dropdown (one more is read to know whether there are more). */
export const SEARCH_GROUP_LIMIT = 5;
/** Shortest query: one character matches nearly everything and cannot use the trigram indexes. */
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 100;

const zoneIds = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.string().uuid()).max(50).optional(),
);

export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_QUERY).max(SEARCH_MAX_QUERY),
  /** optional scope narrowing, as on every list (doc 09 "Zone scope") */
  zoneId: zoneIds,
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  type: z.enum(SEARCH_ENTITY_TYPES),
  id: z.string().uuid(),
  /** order number, or the person's or vendor's name */
  title: z.string(),
  /** masked phone for people and vendors (D26); the customer's name for orders */
  subtitle: z.string().nullable(),
  /** the entity's own status enum value (OrderStatus, CustomerStatus, VendorStatus, PartnerStatus) */
  status: z.string(),
  /** null for customers (shared across zones, D14) and for vendors or partners not yet given a zone */
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  /** orders only: total in integer paise */
  amount: z.number().int().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchGroupSchema = z.object({
  type: z.enum(SEARCH_ENTITY_TYPES),
  items: z.array(searchResultSchema).max(SEARCH_GROUP_LIMIT),
  /** more rows match than are shown */
  hasMore: z.boolean(),
});
export type SearchGroup = z.infer<typeof searchGroupSchema>;

export const searchResponseSchema = z.object({
  q: z.string(),
  /** only the groups this member may view in at least one in-scope zone; a group with no match has no items */
  groups: z.array(searchGroupSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
