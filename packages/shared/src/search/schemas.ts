import { z } from 'zod';
import { normaliseIndianMobile } from '../phone';

// Global header search (M18; doc 09 GET /search, D32 confirmed by D143). Each group is bounded by the member's own
// view zones for that module (doc 04 section 4.3, doc 36: TC-MZ-15) and is null when they can view it nowhere; at most
// five rows a group, with a "see all" link to the module's list. Contacts are always masked (D26, D123).

export const SEARCH_TYPES = [
  'orders',
  'customers',
  'restaurants',
  'homemakers',
  'partners',
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_GROUP_SIZE = 5;

/** `types` is a comma list (`?types=orders,customers`); omitted = every type. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_LENGTH).max(100),
  types: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return [...SEARCH_TYPES];
      const list = [...new Set(v.split(',').map((t) => t.trim()))];
      const bad = list.filter((t) => !(SEARCH_TYPES as readonly string[]).includes(t));
      if (bad.length > 0) {
        ctx.addIssue({ code: 'custom', message: `unknown type: ${bad.join(', ')}` });
        return z.NEVER;
      }
      return list as SearchType[];
    }),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** A typed Indian mobile in any spelling becomes +91XXXXXXXXXX and is matched exactly; anything else is text. */
export function searchTermOf(q: string): { text: string; phone: string | null } {
  return { text: q.trim(), phone: normaliseIndianMobile(q) };
}

export const searchResultSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  /** a short second line; contacts masked */
  subtitle: z.string().nullable(),
  zone: z.object({ id: z.uuid(), name: z.string(), code: z.string() }).nullable(),
  /** the record's page in the web app */
  href: z.string(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

const group = z.array(searchResultSchema).nullable();

export const searchResponseSchema = z.object({
  q: z.string(),
  groups: z.object({
    orders: group,
    customers: group,
    restaurants: group,
    homemakers: group,
    partners: group,
  }),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
