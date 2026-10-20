import { z } from 'zod';

// List conventions (doc 09): page pagination `?page=1&pageSize=25` (max 100), sorting `?sort=-createdAt`, search `?q=`,
// date range `?from=&to=`, repeatable filters. Cursor pagination (audit logs, order history) uses the last id (UUID v7).
// Pure functions: the API, the OpenAPI generator and the web all use the same definitions.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_CURSOR_LIMIT = 50;

const isoDate = z.string().datetime({ offset: true });

/** `?sort=-createdAt` -> { field: 'createdAt', direction: 'desc' }; only fields the endpoint allows. */
export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export function sortSchema(allowed: readonly [string, ...string[]], fallback: SortSpec) {
  return z
    .string()
    .regex(/^-?[A-Za-z][A-Za-z0-9]*$/)
    .refine((v) => allowed.includes(v.replace(/^-/, '')), 'sort field not allowed')
    .transform((v): SortSpec => ({
      field: v.replace(/^-/, ''),
      direction: v.startsWith('-') ? 'desc' : 'asc',
    }))
    .optional()
    .transform((v) => v ?? fallback);
}

/** Filters shared by most lists. Endpoint-specific filters are added with `.extend`. */
const commonFilters = {
  q: z.string().trim().min(1).max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
};

const rangeIsValid = (v: { from?: string | undefined; to?: string | undefined }): boolean =>
  !v.from || !v.to || v.from <= v.to;

/** Page-based list query. `sortable` lists the fields `sort` may name; `fallbackSort` applies when `sort` is absent. */
export function pageQuerySchema(sortable: readonly [string, ...string[]], fallbackSort: SortSpec) {
  return z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
      sort: sortSchema(sortable, fallbackSort),
      ...commonFilters,
    })
    .refine(rangeIsValid, { message: 'from must be before to', path: ['from'] });
}
export type PageQuery = z.infer<ReturnType<typeof pageQuerySchema>>;

/** Cursor-based list query: `after` is the id of the last row of the previous page. */
export const cursorQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_CURSOR_LIMIT),
    after: z.uuid().optional(),
    ...commonFilters,
  })
  .refine(rangeIsValid, { message: 'from must be before to', path: ['from'] });
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** Repeatable query parameter (`?status=A&status=B` or `?status=A`) as an array; absent stays undefined. */
export const multiValue = <S extends z.ZodType>(item: S) =>
  z.preprocess(
    (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
    z.array(item).max(50).optional(),
  );

// ---- responses ---------------------------------------------------------------------------------------------------

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export const pageResponseSchema = <S extends z.ZodType>(item: S) =>
  z.object({ data: z.array(item), meta: pageMetaSchema });

/** Rows to skip / take for a page query. */
export const pageWindow = (q: {
  page: number;
  pageSize: number;
}): { skip: number; take: number } => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

export const buildPage = <T>(
  data: T[],
  total: number,
  q: { page: number; pageSize: number },
): Page<T> => ({
  data,
  meta: { page: q.page, pageSize: q.pageSize, total },
});

export interface CursorMeta {
  limit: number;
  /** id to send as `after` for the next page; null when this was the last page */
  nextCursor: string | null;
}
export interface CursorPage<T> {
  data: T[];
  meta: CursorMeta;
}

export const cursorMetaSchema = z.object({
  limit: z.number().int(),
  nextCursor: z.string().nullable(),
});
export const cursorResponseSchema = <S extends z.ZodType>(item: S) =>
  z.object({ data: z.array(item), meta: cursorMetaSchema });

/** Repositories fetch `limit + 1` rows; the extra row only tells us there is a next page. */
export const cursorFetchSize = (limit: number): number => limit + 1;

export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  idOf: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, meta: { limit, nextCursor: hasMore && last !== undefined ? idOf(last) : null } };
}
