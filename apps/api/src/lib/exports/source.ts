import type { AuditActionKey, AuditModule, ExportModule, PermissionKey } from '@zoauro/shared';
import type { AuthContext } from '../authz';
import { csvHeader, csvRows, type CsvColumn } from './csv';

// What a module plugs into the export service: its view permission, its audit action, how to validate the query it
// was asked with, how to count and page through the SAME scoped list endpoint, and its CSV columns. The service never
// queries a module's tables itself, so the export can never see more than the module's own list would show.

/** The list query as the client sent it (strings), minus page, pageSize and zoneId. Stored, re-parsed in the worker. */
export type RawQuery = Record<string, string | string[]>;

export interface ExportLookups {
  zoneName(zoneId: string): string;
}

export interface ExportSource {
  module: ExportModule;
  viewKey: PermissionKey;
  audit: { module: AuditModule; action: AuditActionKey };
  /** throws VALIDATION_ERROR like the list endpoint would */
  validate(raw: RawQuery): void;
  count(ctx: AuthContext, raw: RawQuery): Promise<number>;
  header(): string;
  /** CSV text of the rows, one page at a time, read through the module's scoped service */
  chunks(
    ctx: AuthContext,
    raw: RawQuery,
    lookups: ExportLookups,
  ): AsyncIterable<{ csv: string; rows: number }>;
  filename(at: Date): string;
}

export function defineExportSource<Q, R>(def: {
  module: ExportModule;
  viewKey: PermissionKey;
  audit: { module: AuditModule; action: AuditActionKey };
  parse(raw: RawQuery): Q;
  count(ctx: AuthContext, q: Q): Promise<number>;
  /** one page (1-based) of rows; an empty page ends the export */
  page(ctx: AuthContext, q: Q, page: number): Promise<readonly R[]>;
  columns(lookups: ExportLookups): readonly CsvColumn<R>[];
  filename(at: Date): string;
}): ExportSource {
  const noLookups: ExportLookups = { zoneName: () => '' };
  return {
    module: def.module,
    viewKey: def.viewKey,
    audit: def.audit,
    validate: (raw) => void def.parse(raw),
    count: (ctx, raw) => def.count(ctx, def.parse(raw)),
    header: () => csvHeader(def.columns(noLookups)),
    filename: def.filename,
    async *chunks(ctx, raw, lookups) {
      const q = def.parse(raw);
      const columns = def.columns(lookups);
      for (let page = 1; ; page++) {
        const rows = await def.page(ctx, q, page);
        if (rows.length === 0) return;
        yield { csv: csvRows(columns, rows), rows: rows.length };
      }
    },
  };
}

/** req.query without the paging and zone parameters, as plain strings (what the source re-parses). */
export function rawQueryOf(query: Record<string, unknown>): RawQuery {
  const out: RawQuery = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === 'page' || k === 'pageSize' || k === 'zoneId') continue;
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && v.every((x): x is string => typeof x === 'string')) out[k] = v;
  }
  return out;
}

/** The page size every source reads with (the list maximum, doc 09). */
export const EXPORT_PAGE_SIZE = 100;

/**
 * A source for any page-based list service (`{ data, meta: { total } }`, doc 09 pagination): the query is validated with
 * the list's own schema, counted with one row, then read page by page with the list maximum. The list service applies
 * its zone scope and masking, so the export holds exactly what the list would show.
 */
export function pagedListSource<Q extends { page: number; pageSize: number }, R>(def: {
  module: ExportSource['module'];
  viewKey: ExportSource['viewKey'];
  audit: ExportSource['audit'];
  parse(raw: RawQuery): Q;
  list(ctx: AuthContext, q: Q): Promise<{ data: readonly R[]; meta: { total: number } }>;
  columns(lookups: ExportLookups): readonly CsvColumn<R>[];
  filename(at: Date): string;
}): ExportSource {
  return defineExportSource<Q, R>({
    module: def.module,
    viewKey: def.viewKey,
    audit: def.audit,
    parse: def.parse,
    count: async (ctx, q) => (await def.list(ctx, { ...q, page: 1, pageSize: 1 })).meta.total,
    page: async (ctx, q, page) =>
      (await def.list(ctx, { ...q, page, pageSize: EXPORT_PAGE_SIZE })).data,
    columns: def.columns,
    filename: def.filename,
  });
}

/** `<name>-<yyyy-mm-dd>.csv` */
export const datedFilename =
  (name: string) =>
  (at: Date): string =>
    `${name}-${at.toISOString().slice(0, 10)}.csv`;
