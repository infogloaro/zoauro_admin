import { describe, expect, it } from 'vitest';
import {
  listMenuItemsQuerySchema,
  menuItemApprovalSchema,
  menuItemFormSchema,
  menuItemFormToPayload,
  menuItemFormToUpdate,
  menuItemUpdateSchema,
  type MenuItemFormValues,
} from './menu';

const zoneId = '11111111-1111-4111-8111-111111111111';
const vendorId = '22222222-2222-4222-8222-222222222222';

const form: MenuItemFormValues = {
  vendorType: 'restaurant',
  vendorId,
  name: 'Paneer Butter Masala',
  description: 'Creamy tomato gravy',
  category: 'Main course',
  price: '260',
  stock: '40',
  isAvailable: true,
  isFeatured: false,
  dietary: 'VEGETARIAN',
};

describe('menuItemFormToPayload', () => {
  it('converts the rupee price to integer paise (money rule: never floats)', () => {
    const payload = menuItemFormToPayload(form, zoneId);
    expect(payload.price).toBe(26_000);
    expect(Number.isInteger(payload.price)).toBe(true);
  });

  it('keeps the selected provider zone and drops empty optionals', () => {
    const payload = menuItemFormToPayload({ ...form, description: '  ', category: '' }, zoneId);
    expect(payload.zoneId).toBe(zoneId);
    expect(payload.vendorId).toBe(vendorId);
    expect(payload.vendorType).toBe('restaurant');
    expect(payload.description).toBeUndefined();
    expect(payload.category).toBeUndefined();
  });
});

describe('menuItemFormToUpdate', () => {
  it('includes every editable field — name, price (paise), dietary, description, category', () => {
    const update = menuItemFormToUpdate({
      ...form,
      name: 'Palak Paneer',
      price: '275',
      dietary: 'NON_VEG',
      description: '',
      category: 'Mains',
    });
    expect(update).toEqual({
      name: 'Palak Paneer',
      description: null,
      category: 'Mains',
      price: 27_500,
      stock: 40,
      isAvailable: true,
      isFeatured: false,
      dietary: 'NON_VEG',
    });
  });

  it('round-trips through the shared update schema the API validates with', () => {
    const update = menuItemFormToUpdate(form);
    const parsed = menuItemUpdateSchema.safeParse(update);
    expect(parsed.success).toBe(true);
  });

  it('never emits owner, zone or approval fields (immutable on edit)', () => {
    const update = menuItemFormToUpdate(form) as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual(
      [
        'category',
        'description',
        'dietary',
        'isAvailable',
        'isFeatured',
        'name',
        'price',
        'stock',
      ].sort(),
    );
  });
});

describe('listMenuItemsQuerySchema (tab status filters)', () => {
  it('accepts each approval status the four tabs send', () => {
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const) {
      const parsed = listMenuItemsQuerySchema.parse({ status });
      expect(parsed.status).toBe(status);
    }
  });

  it('rejects a fabricated status instead of silently ignoring it', () => {
    expect(listMenuItemsQuerySchema.safeParse({ status: 'LIVE' }).success).toBe(false);
  });

  it('combines status with search, zone, vendorType and dietary', () => {
    const parsed = listMenuItemsQuerySchema.parse({
      q: 'dosa',
      status: 'PENDING',
      zoneId,
      vendorType: 'homemaker',
      dietary: 'VEGETARIAN',
      page: '2',
      pageSize: '6',
    });
    expect(parsed).toMatchObject({
      q: 'dosa',
      status: 'PENDING',
      zoneId,
      vendorType: 'homemaker',
      dietary: 'VEGETARIAN',
      page: 2,
      pageSize: 6,
    });
  });
});

describe('menuItemFormSchema (create/edit validation)', () => {
  it('accepts a complete valid form', () => {
    expect(menuItemFormSchema.safeParse(form).success).toBe(true);
  });

  it('rejects a name below 2 characters and a non-numeric or zero price', () => {
    expect(menuItemFormSchema.safeParse({ ...form, name: 'X' }).success).toBe(false);
    expect(menuItemFormSchema.safeParse({ ...form, price: '0' }).success).toBe(false);
    expect(menuItemFormSchema.safeParse({ ...form, price: '26.5' }).success).toBe(false);
    expect(menuItemFormSchema.safeParse({ ...form, price: 'abc' }).success).toBe(false);
  });

  it('requires a provider selection', () => {
    expect(menuItemFormSchema.safeParse({ ...form, vendorId: '' }).success).toBe(false);
  });
});

describe('menuItemApprovalSchema', () => {
  it('requires a reason when rejecting', () => {
    expect(menuItemApprovalSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(
      menuItemApprovalSchema.safeParse({ decision: 'REJECTED', reason: 'Blurry photo' }).success,
    ).toBe(true);
  });
});
