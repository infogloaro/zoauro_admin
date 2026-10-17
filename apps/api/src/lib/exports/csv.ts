// CSV for export files (RFC 4180, UTF-8 with BOM so spreadsheet apps read Indian names correctly).
// Formula injection (doc 13): a cell that starts with = + - @ tab or CR is prefixed with a single quote, so a vendor or
// customer name such as "=HYPERLINK(...)" is shown as text instead of being run by the spreadsheet.

export interface CsvColumn<R> {
  header: string;
  value: (row: R) => string | number | boolean | null;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: string | number | boolean | null): string {
  if (v === null) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_BOM = '﻿';

export function csvHeader<R>(columns: readonly CsvColumn<R>[]): string {
  return `${columns.map((c) => csvCell(c.header)).join(',')}\r\n`;
}

export function csvRows<R>(columns: readonly CsvColumn<R>[], rows: readonly R[]): string {
  return rows.map((r) => `${columns.map((c) => csvCell(c.value(r))).join(',')}\r\n`).join('');
}

/** Paise as rupees with two decimals, no grouping (a CSV value, not display text). */
export const rupees = (paise: number): string => (paise / 100).toFixed(2);
