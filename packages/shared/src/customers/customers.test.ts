import { describe, expect, it } from 'vitest';
import {
  customerBlockSchema,
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
} from './schemas';

const ZONE = '0192f1d2-0000-7000-8000-000000000001';

describe('customer contract (D25, D28)', () => {
  it('create needs a first address with its zone; the phone is stored as E.164', () => {
    const base = { name: 'Priya', phone: '98765 43210' };
    expect(customerCreateSchema.safeParse(base).success).toBe(false);
    const ok = customerCreateSchema.parse({
      ...base,
      address: { zoneId: ZONE, address: '4 Lake View', pincode: '600001' },
    });
    expect(ok.phone).toBe('+919876543210');
    expect(
      customerCreateSchema.safeParse({
        ...base,
        source: 'APP',
        address: { zoneId: ZONE, address: 'x y z' },
      }).success,
    ).toBe(false);
  });

  it('update never carries status; block needs a reason', () => {
    expect(customerUpdateSchema.safeParse({}).success).toBe(false);
    expect(customerUpdateSchema.safeParse({ status: 'BLOCKED' }).success).toBe(false);
    expect(customerUpdateSchema.safeParse({ email: null }).success).toBe(true);
    expect(customerBlockSchema.safeParse({}).success).toBe(false);
    expect(customerBlockSchema.safeParse({ reason: 'Repeated fake orders' }).success).toBe(true);
  });

  it('list: repeatable zoneId, source allow-list', () => {
    expect(customerListQuerySchema.parse({ zoneId: ZONE }).zoneId).toEqual([ZONE]);
    expect(customerListQuerySchema.safeParse({ source: 'IMPORT' }).success).toBe(true);
    expect(customerListQuerySchema.safeParse({ source: 'WEB' }).success).toBe(false);
  });
});
