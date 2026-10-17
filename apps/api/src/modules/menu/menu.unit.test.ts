import { describe, expect, it } from 'vitest';
import {
  approvedCreate,
  approvedUpdate,
  changeRows,
  decisionBlocker,
  splitVendorChange,
} from './change-requests.rules';
import { adjustPrice, planBulk, type BulkItem } from './menu.bulk';

const Z1 = '0192f1d2-0000-7000-8000-0000000000a1';
const Z2 = '0192f1d2-0000-7000-8000-0000000000a2';
const C1 = '0192f1d2-0000-7000-8000-0000000000c1';
const C2 = '0192f1d2-0000-7000-8000-0000000000c2';
const I1 = '0192f1d2-0000-7000-8000-000000000001';
const I2 = '0192f1d2-0000-7000-8000-000000000002';

const items: BulkItem[] = [
  { id: I1, zoneId: Z1, name: 'Idli', price: 105, categoryId: C1, adminDisabled: false },
  { id: I2, zoneId: Z2, name: 'Dosa', price: 1, categoryId: C2, adminDisabled: true },
];

describe('price adjustment (D124)', () => {
  it('rounds percentages half-up in integer paise', () => {
    expect(adjustPrice(105, 'percent', 10)).toBe(116); // 115.5 -> 116
    expect(adjustPrice(105, 'percent', -10)).toBe(95); // 94.5 -> 95
    expect(adjustPrice(999, 'percent', 12.5)).toBe(1124); // 1123.875 -> 1124
    expect(adjustPrice(10_000, 'percent', 0.01)).toBe(10_001);
    expect(adjustPrice(5000, 'amount', -250)).toBe(4750);
  });

  it('refuses a non-integer price', () => {
    expect(() => adjustPrice(10.5, 'amount', 1)).toThrow(TypeError);
  });
});

describe('bulk plan', () => {
  it('price: before/after per item, below 1 paise skipped, no write for a skipped item', () => {
    const p = planBulk({ action: 'price', ids: [I1, I2], mode: 'amount', value: -100 }, items);
    expect(p.changes).toEqual([{ id: I1, name: 'Idli', before: 105, after: 5 }]);
    expect(p.skipped).toEqual([{ id: I2, reason: 'PRICE_BELOW_MINIMUM' }]);
    expect(p.changeIds).toEqual([I1]);
    expect(p.write.field === 'price' && [...p.write.values]).toEqual([[I1, 5]]);
  });

  it('availability: an item already in the target state is UNCHANGED', () => {
    const p = planBulk(
      { action: 'availability', ids: [I1, I2], adminDisabled: true, reason: 'Hygiene check' },
      items,
    );
    expect(p.changeIds).toEqual([I1]);
    expect(p.skipped).toEqual([{ id: I2, reason: 'UNCHANGED' }]);
  });

  it('category: a zone category applies only to items of its zone; a global one to all', () => {
    const zoneCat = planBulk({ action: 'category', ids: [I1, I2], categoryId: C2 }, items, {
      id: C2,
      zoneId: Z1,
    });
    expect(zoneCat.changeIds).toEqual([I1]);
    expect(zoneCat.skipped).toEqual([{ id: I2, reason: 'CATEGORY_OTHER_ZONE' }]);
    const global = planBulk({ action: 'category', ids: [I1, I2], categoryId: C2 }, items, {
      id: C2,
      zoneId: null,
    });
    expect(global.changeIds).toEqual([I1]);
    expect(global.skipped).toEqual([{ id: I2, reason: 'UNCHANGED' }]);
  });

  it('throws when the caller did not load every requested item (all-or-nothing is the caller’s check)', () => {
    expect(() =>
      planBulk({ action: 'availability', ids: [C1], adminDisabled: false }, items),
    ).toThrow();
  });
});

describe('change request rules (R09, D127)', () => {
  const proposal = {
    name: 'Ghee Idli',
    price: 6000,
    stock: 4,
    isAvailable: false,
    categoryId: C1,
  };

  it('splits approval fields from the ones that apply at once', () => {
    expect(splitVendorChange(proposal)).toEqual({
      needsApproval: { name: 'Ghee Idli', price: 6000, categoryId: C1 },
      immediate: { stock: 4, isAvailable: false },
    });
  });

  it('approving an update writes only the whitelist, even when the stored JSON holds more', () => {
    const tampered = { ...proposal, adminDisabled: false, zoneId: Z2 } as unknown as Parameters<
      typeof approvedUpdate
    >[0];
    expect(approvedUpdate(tampered)).toEqual({ name: 'Ghee Idli', price: 6000, categoryId: C1 });
  });

  it('a create needs name, price and category; stock and availability default', () => {
    expect(approvedCreate({ name: 'Vada' })).toEqual({
      ok: false,
      missing: ['price', 'categoryId'],
    });
    const ok = approvedCreate({ name: 'Vada', price: 2000, categoryId: C1 });
    expect(ok.ok && ok.row).toEqual({
      name: 'Vada',
      price: 2000,
      categoryId: C1,
      stock: 0,
      isAvailable: true,
    });
  });

  it('review rows flag a field an admin changed after the vendor submitted', () => {
    const rows = changeRows(
      { price: 6000, name: 'Ghee Idli' },
      { price: 5000, name: 'Idli' },
      {
        price: 5500,
        name: 'Idli',
      },
    );
    expect(rows).toEqual([
      { field: 'name', base: 'Idli', live: 'Idli', proposed: 'Ghee Idli', liveChanged: false },
      { field: 'price', base: 5000, live: 5500, proposed: 6000, liveChanged: true },
    ]);
  });

  it('decides only a PENDING request at the version the reviewer saw', () => {
    expect(decisionBlocker({ status: 'PENDING', version: 2 }, 2)).toBeNull();
    expect(decisionBlocker({ status: 'PENDING', version: 3 }, 2)).toBe('STALE_VERSION');
    expect(decisionBlocker({ status: 'SUPERSEDED', version: 2 }, 2)).toBe('NOT_PENDING');
  });
});
