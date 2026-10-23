import type { MenuBulkPreviewResponse, MenuItemBulkInput } from '@zoauro/shared';
import { ApiError } from '../../lib/api';
import { formatRupees } from '../../lib/format';

/**
 * Bulk value actions (doc 09 /bulk/preview + /bulk, D124 all-or-nothing):
 * the draft is form-string state, `bulkValueBody` turns it into the shared
 * discriminated union (rupees → paise at this edge), and the dialog flow is
 * preview (dry run) → confirm → apply with the *same* body object, so what
 * the operator reviewed is exactly what is written.
 */

export type BulkValueAction = 'availability' | 'category' | 'price';

export interface BulkValueDraft {
  action: BulkValueAction;
  available: boolean;
  category: string;
  priceMode: 'percent' | 'amount';
  percent: string;
  amountRupees: string;
}

export const EMPTY_BULK_DRAFT: BulkValueDraft = {
  action: 'availability',
  available: true,
  category: '',
  priceMode: 'percent',
  percent: '',
  amountRupees: '',
};

export type BulkValueBodyResult =
  { ok: true; body: MenuItemBulkInput } | { ok: false; error: string };

/** Draft → wire body. Client-side checks mirror the shared zod schema so a
 * bad draft never leaves the browser; the server stays the authority. */
export function bulkValueBody(draft: BulkValueDraft, ids: string[]): BulkValueBodyResult {
  if (ids.length === 0) return { ok: false, error: 'Select at least one item' };

  if (draft.action === 'availability') {
    return { ok: true, body: { action: 'availability', ids, available: draft.available } };
  }

  if (draft.action === 'category') {
    const category = draft.category.trim();
    return {
      ok: true,
      body: { action: 'category', ids, category: category === '' ? null : category },
    };
  }

  if (draft.priceMode === 'percent') {
    const raw = draft.percent.trim();
    const percent = Number(raw);
    if (raw === '' || !Number.isFinite(percent) || percent < -99 || percent > 1000) {
      return { ok: false, error: 'Percent must be a number between -99 and 1000' };
    }
    return { ok: true, body: { action: 'price', ids, percent } };
  }

  const rawAmount = draft.amountRupees.trim();
  const rupees = Number(rawAmount);
  const paise = Math.round(rupees * 100);
  if (rawAmount === '' || !Number.isFinite(rupees) || rupees < 1 || paise < 1) {
    return { ok: false, error: 'Enter a price of ₹1 or more' };
  }
  return { ok: true, body: { action: 'price', ids, amountPaise: paise } };
}

/** Step 1 of the flow: POST /bulk/preview (never writes). */
export async function previewBulkValue(
  body: MenuItemBulkInput,
  preview: (input: MenuItemBulkInput) => Promise<MenuBulkPreviewResponse>,
): Promise<MenuBulkPreviewResponse['data']> {
  const response = await preview(body);
  return response.data;
}

/** Step 2: POST /bulk with the identical body the preview ran on. */
export async function applyBulkValue<T>(
  body: MenuItemBulkInput,
  apply: (input: MenuItemBulkInput) => Promise<T>,
): Promise<T> {
  return apply(body);
}

export type BulkValueErrorKind = 'missing' | 'conflict' | 'validation' | 'unknown';

export interface ClassifiedBulkError {
  kind: BulkValueErrorKind;
  message: string;
}

/** D124 failures: 404 = an id vanished (offer a refresh), 409 = category
 * clash in one provider, 422 = a result would fall below ₹1. */
export function classifyBulkValueError(error: unknown): ClassifiedBulkError {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: 'missing', message: error.message };
    if (error.status === 409) return { kind: 'conflict', message: error.message };
    if (error.status === 422) return { kind: 'validation', message: error.message };
    return { kind: 'unknown', message: error.message };
  }
  return { kind: 'unknown', message: 'Could not apply the bulk action.' };
}

/** Preview cells: money in paise, booleans as On/Off, null as “—”. */
export function formatBulkPreviewValue(
  field: string,
  value: string | number | boolean | null,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (field === 'price' && typeof value === 'number') return formatRupees(value);
  return String(value);
}
