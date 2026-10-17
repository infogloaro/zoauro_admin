import {
  MENU_APPROVAL_FIELDS,
  MENU_IMMEDIATE_FIELDS,
  type MenuApprovalField,
  type MenuChangeProposal,
  type MenuChangeStatus,
} from '@zoauro/shared';

// Vendor item-change requests (R09, D119, D127), pure rules shared by the submit port (intake), the review screen and
// the approve transaction:
//  - a vendor change splits into the fields that wait for approval (name, description, price, category, dietary,
//    image) and the ones that apply at once (stock, availability);
//  - approving writes ONLY the approval whitelist, whatever else the stored JSON holds;
//  - only a PENDING request can be decided, and only at the version the reviewer saw.

type FieldValue = string | number | boolean | null;

/** Present keys of `p` that are in `fields`, in the whitelist's order. */
function pick<K extends keyof MenuChangeProposal>(
  p: MenuChangeProposal,
  fields: readonly K[],
): Pick<MenuChangeProposal, K> {
  const out: Partial<MenuChangeProposal> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(p, f) && p[f] !== undefined)
      Object.assign(out, { [f]: p[f] });
  }
  return out as Pick<MenuChangeProposal, K>;
}

/** The approval part and the immediate part of a vendor UPDATE. */
export function splitVendorChange(p: MenuChangeProposal): {
  needsApproval: Pick<MenuChangeProposal, MenuApprovalField>;
  immediate: Pick<MenuChangeProposal, (typeof MENU_IMMEDIATE_FIELDS)[number]>;
} {
  return {
    needsApproval: pick(p, MENU_APPROVAL_FIELDS),
    immediate: pick(p, MENU_IMMEDIATE_FIELDS),
  };
}

/** Only the whitelist reaches menu_items on approval of an UPDATE (stock/availability were applied on submit). */
export function approvedUpdate(p: MenuChangeProposal): Pick<MenuChangeProposal, MenuApprovalField> {
  return pick(p, MENU_APPROVAL_FIELDS);
}

/** A CREATE inserts the whitelist plus the initial stock and availability; name, price and category are required. */
export function approvedCreate(p: MenuChangeProposal):
  | {
      ok: true;
      row: Pick<MenuChangeProposal, MenuApprovalField> & {
        name: string;
        price: number;
        categoryId: string;
        stock: number;
        isAvailable: boolean;
      };
    }
  | { ok: false; missing: ('name' | 'price' | 'categoryId')[] } {
  const w = pick(p, MENU_APPROVAL_FIELDS);
  const missing = (['name', 'price', 'categoryId'] as const).filter((f) => w[f] === undefined);
  if (
    missing.length > 0 ||
    w.name === undefined ||
    w.price === undefined ||
    w.categoryId === undefined
  )
    return { ok: false, missing: [...missing] };
  return {
    ok: true,
    row: {
      ...w,
      name: w.name,
      price: w.price,
      categoryId: w.categoryId,
      stock: p.stock ?? 0,
      isAvailable: p.isAvailable ?? true,
    },
  };
}

/** Fields of the whitelist the request touches (list column "fields"). */
export function changedFields(p: MenuChangeProposal): MenuApprovalField[] {
  return MENU_APPROVAL_FIELDS.filter((f) => p[f] !== undefined);
}

/** Review rows: base (at submission), live (now) and proposed, for every whitelisted field the request touches. */
export function changeRows(
  proposed: MenuChangeProposal,
  base: MenuChangeProposal | null,
  live: MenuChangeProposal | null,
): {
  field: MenuApprovalField;
  base: FieldValue;
  live: FieldValue;
  proposed: FieldValue;
  liveChanged: boolean;
}[] {
  return changedFields(proposed).map((field) => {
    const b = base?.[field] ?? null;
    const l = live?.[field] ?? null;
    return {
      field,
      base: b,
      live: l,
      proposed: proposed[field] ?? null,
      liveChanged: base !== null && b !== l,
    };
  });
}

/** null = the request may be decided; otherwise why not (the service answers 409 with it). */
export function decisionBlocker(
  current: { status: MenuChangeStatus; version: number },
  expectedVersion: number,
): 'NOT_PENDING' | 'STALE_VERSION' | null {
  if (current.status !== 'PENDING') return 'NOT_PENDING';
  if (current.version !== expectedVersion) return 'STALE_VERSION';
  return null;
}
