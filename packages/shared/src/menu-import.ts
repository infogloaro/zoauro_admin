import { z } from 'zod';
import { DIETARY_TYPES, type DietaryType } from './enums';
import { itemNameSchema, type MenuOwnerKind } from './menu';

/**
 * A6 Menu Import CSV (doc 34 SA-2.5 "Menu import CSV (Figma 'Import' button)
 * with dry-run, formula-injection escaping", doc 09 `POST /menu-items/import`,
 * doc 13 T16, doc 37 row 12). The request shape is not spelled out in doc 09
 * (the row's note cell only carries the P1 marker), so the contract below is
 * the documented minimum: a CSV body with a dry-run flag, a per-row report,
 * and T16 escaping on every free-text cell before it is validated or stored.
 * Nothing here decides approval — imported items always land PENDING
 * (doc 10 §4 workflow, model default).
 */

/** Required header cells (case-insensitive; extra columns are ignored). */
export const MENU_IMPORT_REQUIRED_COLUMNS = [
  'zone',
  'provider',
  'type',
  'name',
  'price',
  'dietary',
] as const;

/** Hard caps: an admin upload, not a data-migration job (doc 44 §5 is IH-9). */
export const MENU_IMPORT_MAX_ROWS = 1000;
export const MENU_IMPORT_MAX_CSV_CHARS = 400_000;

/** POST /menu-items/import body. */
export const menuItemImportSchema = z.object({
  csv: z
    .string()
    .min(1, 'The file is empty')
    .max(MENU_IMPORT_MAX_CSV_CHARS, 'The file is too large (max 400 KB)'),
  dryRun: z.boolean(),
});
export type MenuItemImportInput = z.infer<typeof menuItemImportSchema>;

/**
 * Doc 13 T16: prefix `'` for cells starting `= + - @` so a formula imported
 * from a spreadsheet can never execute when this data is exported again.
 * Lookup columns (zone/provider/type) are matched, never stored, so they are
 * not rewritten — the export path prefixes every stored cell regardless.
 */
const FORMULA_HEAD = /^[=+\-@]/u;
export function sanitizeImportText(value: string): string {
  const trimmed = value.trim();
  return FORMULA_HEAD.test(trimmed) ? `'${trimmed}` : trimmed;
}

/* ------------------------------------------------------------------ *
 * CSV parsing (RFC 4180 subset: quotes, "" escapes, CRLF/CR/LF)
 * ------------------------------------------------------------------ */

export type MenuImportParseResult =
  | { ok: true; rows: Array<{ row: number; values: Record<string, string> }> }
  | { ok: false; issue: string };

function splitCsvRecords(csv: string): { records: string[][]; unterminated: boolean } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    record.push(field);
    field = '';
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < csv.length) {
    const ch = csv[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += csv[i + 1] === '\n' ? 2 : 1;
      pushRecord();
      continue;
    }
    if (ch === '\n') {
      i += 1;
      pushRecord();
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) return { records, unterminated: true };
  if (field.length > 0 || record.length > 0) pushRecord();
  return { records, unterminated: false };
}

function isBlankRecord(record: string[]): boolean {
  return record.every((cell) => cell.trim() === '');
}

/** Structural pass: header present, required columns there, row cap respected. */
export function parseMenuImportCsv(csv: string): MenuImportParseResult {
  const body = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const { records, unterminated } = splitCsvRecords(body);
  if (unterminated) return { ok: false, issue: 'A quoted value is not closed' };

  const meaningful = records.filter((r) => !isBlankRecord(r));
  const header = meaningful[0];
  if (!header) return { ok: false, issue: 'The file is empty' };

  const columns = header.map((c) => c.trim().toLowerCase());
  const missing = MENU_IMPORT_REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    return { ok: false, issue: `Missing required column(s): ${missing.join(', ')}` };
  }

  const data = meaningful.slice(1);
  if (data.length > MENU_IMPORT_MAX_ROWS) {
    return { ok: false, issue: `Too many rows (max ${MENU_IMPORT_MAX_ROWS})` };
  }

  const rows = data.map((record, index) => {
    const values: Record<string, string> = {};
    columns.forEach((column, position) => {
      values[column] = record[position] ?? '';
    });
    return { row: index + 1, values };
  });
  return { ok: true, rows };
}

/* ------------------------------------------------------------------ *
 * Row validation (field level; owner lookup happens server-side)
 * ------------------------------------------------------------------ */

export interface MenuImportDraft {
  row: number;
  zone: string;
  provider: string;
  type: MenuOwnerKind;
  name: string;
  description: string | null;
  category: string | null;
  /** Integer paise (AGENTS.md money rule). */
  price: number;
  dietary: DietaryType;
}

export interface MenuImportRowError {
  row: number;
  field: string;
  issue: string;
}

/** Accepted `type` cell values (lowercase; also printed in row errors). */
export const MENU_IMPORT_TYPES = ['restaurant', 'homemaker', 'hotel'] as const;

/** Accepts enum values and the display labels (VEGETARIAN / Vegetarian …). */
const DIETARY_ALIASES: Record<string, DietaryType> = {
  vegetarian: 'VEGETARIAN',
  non_veg: 'NON_VEG',
  'non-veg': 'NON_VEG',
  'non veg': 'NON_VEG',
  egg: 'EGG',
};

const TYPE_ALIASES: Record<string, MenuOwnerKind> = {
  restaurant: 'restaurant',
  homemaker: 'homemaker',
  hotel: 'hotel',
};

/**
 * Validates every data row and returns the rows that may be imported plus a
 * row-numbered error list (the dry-run report, doc 34 SA-2.5). Free-text
 * cells are T16-sanitised before validation, so a hostile formula is neutral
 * before it can reach the database.
 */
export function validateMenuImportRows(
  rows: Array<{ row: number; values: Record<string, string> }>,
): { valid: MenuImportDraft[]; errors: MenuImportRowError[] } {
  const valid: MenuImportDraft[] = [];
  const errors: MenuImportRowError[] = [];

  for (const { row, values } of rows) {
    const rowErrors: MenuImportRowError[] = [];
    const add = (field: string, issue: string): void => {
      rowErrors.push({ row, field, issue });
    };

    const zone = (values.zone ?? '').trim();
    if (zone === '') add('zone', 'Zone is required');
    else if (zone.length > 80) add('zone', 'Zone must be at most 80 characters');

    const provider = (values.provider ?? '').trim();
    if (provider === '') add('provider', 'Provider is required');
    else if (provider.length > 80) add('provider', 'Provider must be at most 80 characters');

    const rawType = (values.type ?? '').trim().toLowerCase();
    const type = TYPE_ALIASES[rawType];
    if (!type) add('type', `Type must be ${MENU_IMPORT_TYPES.join(', ')}`);

    const nameResult = itemNameSchema.safeParse(sanitizeImportText(values.name ?? ''));
    if (!nameResult.success) add('name', nameResult.error.issues[0]?.message ?? 'Invalid name');
    const name = nameResult.success ? nameResult.data : '';

    let description: string | null = null;
    const rawDescription = sanitizeImportText(values.description ?? '');
    if (rawDescription !== '') {
      if (rawDescription.length > 300)
        add('description', 'Description must be at most 300 characters');
      else description = rawDescription;
    }

    let category: string | null = null;
    const rawCategory = sanitizeImportText(values.category ?? '');
    if (rawCategory !== '') {
      if (rawCategory.length > 60) add('category', 'Category must be at most 60 characters');
      else category = rawCategory;
    }

    let price = 0;
    const rawPrice = (values.price ?? '').trim();
    if (!/^\d{1,6}$/u.test(rawPrice) || Number(rawPrice) < 1) {
      add('price', 'Price must be a whole rupee amount of ₹1 or more');
    } else {
      price = Number(rawPrice) * 100; // rupees → integer paise
    }

    const dietary = DIETARY_ALIASES[(values.dietary ?? '').trim().toLowerCase()];
    if (!dietary) {
      add('dietary', `Dietary must be ${DIETARY_TYPES.join(', ')} (or their labels)`);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    if (!type || !dietary) continue; // unreachable; narrows for TS
    valid.push({
      row,
      zone,
      provider,
      type,
      name,
      description,
      category,
      price,
      dietary,
    });
  }

  return { valid, errors };
}

/* ------------------------------------------------------------------ *
 * Response
 * ------------------------------------------------------------------ */

/**
 * The dry-run and real-run report (doc 34 SA-2.5, doc 44 §5 style: counts
 * match the report; re-running skips what is already on the menu).
 * `valid + invalid = total`; `created + duplicates <= valid`.
 */
export const menuItemImportResponseSchema = z.object({
  data: z.object({
    dryRun: z.boolean(),
    total: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
    duplicates: z.number().int(),
    created: z.number().int(),
    errors: z
      .array(z.object({ row: z.number().int(), field: z.string(), issue: z.string() }))
      .max(200),
  }),
});
export type MenuItemImportResponse = z.infer<typeof menuItemImportResponseSchema>;

export type MenuImportReport = MenuItemImportResponse['data'];

/**
 * Pure report builder shared by the service (real run) and the tests.
 * `invalidRows` counts distinct rows with at least one field error.
 */
export function buildMenuImportReport(input: {
  dryRun: boolean;
  total: number;
  errors: MenuImportRowError[];
  duplicates: number;
  created: number;
  /** Rows that passed field validation (includes duplicates). */
  validRows: number;
}): MenuImportReport {
  const invalidRows = new Set(input.errors.map((e) => e.row)).size;
  return {
    dryRun: input.dryRun,
    total: input.total,
    valid: input.validRows,
    invalid: invalidRows,
    duplicates: input.duplicates,
    created: input.created,
    errors: input.errors.slice(0, 200),
  };
}
