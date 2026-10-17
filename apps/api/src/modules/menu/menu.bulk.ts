import {
  MENU_PRICE_MAX_PAISE,
  type MenuBulkInput,
  type MenuBulkPreview,
  type MenuBulkSkipReason,
} from '@zoauro/shared';

// Menu bulk actions (D124), pure so the preview and the apply run the same calculation and can be unit-tested. The
// caller has already checked that every id is visible and writable (all-or-nothing: else 404, nothing changes).

/** The fields of an item a bulk action reads. */
export interface BulkItem {
  id: string;
  zoneId: string;
  name: string;
  price: number;
  categoryId: string;
  adminDisabled: boolean;
}

/** The target category of a category action: global (zoneId null) or of one zone. */
export interface BulkCategory {
  id: string;
  zoneId: string | null;
}

/**
 * New price in paise after a signed percentage (two decimals) or a signed amount, rounded half-up (away from zero for
 * the exact half: prices are positive). Integer arithmetic only: percent is taken in basis points.
 */
export function adjustPrice(price: number, mode: 'percent' | 'amount', value: number): number {
  if (!Number.isInteger(price)) throw new TypeError('price must be integer paise');
  if (mode === 'amount') return price + value;
  const bp = Math.round(value * 100); // 12.5 % -> 1250
  const scaled = price * (10_000 + bp); // exact in a double below 2^53 (price <= 1e7, factor <= 60_000)
  return Math.floor((scaled + 5_000) / 10_000);
}

export type BulkWrite =
  | { field: 'adminDisabled'; value: boolean }
  | { field: 'categoryId'; value: string }
  | { field: 'price'; values: Map<string, number> };

export interface BulkPlan extends MenuBulkPreview {
  /** ids that change; empty when everything was skipped */
  changeIds: string[];
  write: BulkWrite;
}

/**
 * Before/after per item and the ids that are skipped (no-op, price out of range, category of another zone). `items` is
 * the full requested set (the caller checked it is complete); `category` is the target of a category action.
 */
export function planBulk(
  input: MenuBulkInput,
  items: readonly BulkItem[],
  category?: BulkCategory | null,
): BulkPlan {
  const changes: MenuBulkPreview['changes'] = [];
  const skipped: { id: string; reason: MenuBulkSkipReason }[] = [];
  const prices = new Map<string, number>();
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of input.ids) {
    const item = byId.get(id);
    if (!item) throw new Error(`planBulk: item ${id} not loaded`);
    if (input.action === 'availability') {
      if (item.adminDisabled === input.adminDisabled) skipped.push({ id, reason: 'UNCHANGED' });
      else
        changes.push({
          id,
          name: item.name,
          before: item.adminDisabled,
          after: input.adminDisabled,
        });
    } else if (input.action === 'category') {
      if (!category) throw new Error('planBulk: category not loaded');
      if (category.zoneId !== null && category.zoneId !== item.zoneId)
        skipped.push({ id, reason: 'CATEGORY_OTHER_ZONE' });
      else if (item.categoryId === category.id) skipped.push({ id, reason: 'UNCHANGED' });
      else changes.push({ id, name: item.name, before: item.categoryId, after: category.id });
    } else {
      const after = adjustPrice(item.price, input.mode, input.value);
      if (after < 1) skipped.push({ id, reason: 'PRICE_BELOW_MINIMUM' });
      else if (after > MENU_PRICE_MAX_PAISE) skipped.push({ id, reason: 'PRICE_ABOVE_MAXIMUM' });
      else if (after === item.price) skipped.push({ id, reason: 'UNCHANGED' });
      else {
        changes.push({ id, name: item.name, before: item.price, after });
        prices.set(id, after);
      }
    }
  }
  const write: BulkWrite =
    input.action === 'availability'
      ? { field: 'adminDisabled', value: input.adminDisabled }
      : input.action === 'category'
        ? { field: 'categoryId', value: input.categoryId }
        : { field: 'price', values: prices };
  return { action: input.action, changes, skipped, changeIds: changes.map((c) => c.id), write };
}
