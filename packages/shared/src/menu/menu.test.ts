import { describe, expect, it } from 'vitest';
import {
  categoryCreateSchema,
  changeRequestListQuerySchema,
  changeRequestRejectSchema,
  MENU_BULK_MAX_IDS,
  menuAvailabilityOf,
  menuBulkSchema,
  menuItemCreateSchema,
  menuItemListQuerySchema,
  menuItemUpdateSchema,
} from './schemas';

const ID = '0192f1d2-0000-7000-8000-000000000001';
const ID2 = '0192f1d2-0000-7000-8000-000000000002';
const item = { vendorKind: 'RESTAURANT', vendorId: ID, categoryId: ID2, name: 'Idli', price: 4000 };

describe('menu contract', () => {
  it('creates with defaults, integer paise of at least 1, and no zone or unknown fields', () => {
    expect(menuItemCreateSchema.parse(item)).toMatchObject({
      stock: 0,
      isAvailable: true,
      isFeatured: false,
    });
    expect(menuItemCreateSchema.safeParse({ ...item, price: 0 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...item, price: 40.5 }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...item, zoneId: ID }).success).toBe(false);
    expect(menuItemCreateSchema.safeParse({ ...item, adminDisabled: true }).success).toBe(false);
  });

  it('an update needs a real field, never carries isAvailable, and disabling needs a reason (D126)', () => {
    expect(menuItemUpdateSchema.safeParse({}).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ reason: 'only a reason' }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ isAvailable: false }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ adminDisabled: true }).success).toBe(false);
    expect(menuItemUpdateSchema.safeParse({ adminDisabled: true, reason: 'Hygiene' }).success).toBe(
      true,
    );
    expect(menuItemUpdateSchema.safeParse({ adminDisabled: false }).success).toBe(true);
  });

  it('live = available AND in stock AND not admin-disabled, first reason wins (doc 44)', () => {
    expect(menuAvailabilityOf({ adminDisabled: false, isAvailable: true, stock: 3 })).toBe('live');
    expect(menuAvailabilityOf({ adminDisabled: false, isAvailable: true, stock: 0 })).toBe(
      'out_of_stock',
    );
    expect(menuAvailabilityOf({ adminDisabled: false, isAvailable: false, stock: 0 })).toBe(
      'vendor_off',
    );
    expect(menuAvailabilityOf({ adminDisabled: true, isAvailable: false, stock: 0 })).toBe(
      'admin_disabled',
    );
  });

  it('list query: repeatable zoneId, boolean featured, allowed sort only', () => {
    const q = menuItemListQuerySchema.parse({ zoneId: ID, featured: 'true', sort: '-price' });
    expect(q.zoneId).toEqual([ID]);
    expect(q.featured).toBe(true);
    expect(q.sort).toEqual({ field: 'price', direction: 'desc' });
    expect(menuItemListQuerySchema.safeParse({ sort: 'vendorId' }).success).toBe(false);
  });

  it('bulk: at most 500 distinct ids, reason to disable, sane price adjustments', () => {
    const ids = [ID];
    expect(
      menuBulkSchema.safeParse({ action: 'availability', ids, adminDisabled: false }).success,
    ).toBe(true);
    expect(
      menuBulkSchema.safeParse({ action: 'availability', ids, adminDisabled: true }).success,
    ).toBe(false);
    expect(
      menuBulkSchema.safeParse({ action: 'category', ids: [ID, ID], categoryId: ID2 }).success,
    ).toBe(false);
    const many = Array.from(
      { length: MENU_BULK_MAX_IDS + 1 },
      (_, i) => `0192f1d2-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(
      menuBulkSchema.safeParse({ action: 'category', ids: many, categoryId: ID2 }).success,
    ).toBe(false);
    expect(
      menuBulkSchema.safeParse({ action: 'price', ids, mode: 'percent', value: 12.5 }).success,
    ).toBe(true);
    expect(
      menuBulkSchema.safeParse({ action: 'price', ids, mode: 'percent', value: 12.555 }).success,
    ).toBe(false);
    expect(
      menuBulkSchema.safeParse({ action: 'price', ids, mode: 'percent', value: -95 }).success,
    ).toBe(false);
    expect(
      menuBulkSchema.safeParse({ action: 'price', ids, mode: 'amount', value: -500 }).success,
    ).toBe(true);
    expect(
      menuBulkSchema.safeParse({ action: 'price', ids, mode: 'amount', value: 1.5 }).success,
    ).toBe(false);
    expect(
      menuBulkSchema.safeParse({ action: 'price', ids, mode: 'amount', value: 0 }).success,
    ).toBe(false);
  });

  it('a category names its zone explicitly (null = global)', () => {
    expect(categoryCreateSchema.safeParse({ name: 'Starters' }).success).toBe(false);
    expect(categoryCreateSchema.parse({ zoneId: null, name: 'Starters' }).sortOrder).toBe(0);
    expect(categoryCreateSchema.safeParse({ zoneId: ID, name: ' ' }).success).toBe(false);
  });

  it('change requests: PENDING queue by default, a reject needs a reason and the version', () => {
    expect(changeRequestListQuerySchema.parse({}).status).toBe('PENDING');
    expect(changeRequestRejectSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(changeRequestRejectSchema.safeParse({ version: 1, reason: 'Wrong price' }).success).toBe(
      true,
    );
  });
});
