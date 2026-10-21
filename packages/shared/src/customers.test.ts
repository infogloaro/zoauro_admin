import { describe, expect, it } from 'vitest';
import { CUSTOMER_SOURCES, CUSTOMER_STATUSES } from './enums';
import {
  customerCreateSchema,
  customerEditFormSchema,
  customerEditFormToUpdate,
  customerFormSchema,
  customerFormToPayload,
  customerRevealSchema,
  customerUpdateSchema,
  listCustomersQuerySchema,
  requestedCustomerZoneIds,
  type CustomerFormValues,
} from './customers';

const zoneId = '11111111-1111-4111-8111-111111111111';

const form: CustomerFormValues = {
  name: 'Aarti Menon',
  phone: '9840012345',
  email: 'aarti@example.in',
  zoneId,
  address: '14, Kamaraj Salai, Adyar',
  area: 'Adyar',
  status: 'ACTIVE',
};

describe('customerFormToPayload', () => {
  it('keeps the first-address zone and drops empty optionals', () => {
    const payload = customerFormToPayload({ ...form, email: '', area: '  ' });
    expect(payload).toEqual({
      name: 'Aarti Menon',
      phone: '9840012345',
      zoneId,
      address: '14, Kamaraj Salai, Adyar',
      status: 'ACTIVE',
    });
    expect(payload.email).toBeUndefined();
    expect(payload.area).toBeUndefined();
  });

  it('never carries a source — D28 fixes admin-created rows to ADMIN server-side', () => {
    const payload = customerFormToPayload(form);
    expect(payload).not.toHaveProperty('source');
  });
});

describe('customerEditFormToUpdate', () => {
  it('clears the email with null and keeps the profile fields', () => {
    expect(customerEditFormToUpdate({ name: 'Aarti M', email: '', status: 'BLOCKED' })).toEqual({
      name: 'Aarti M',
      email: null,
      status: 'BLOCKED',
    });
  });
});

describe('customer form schemas', () => {
  it('requires the first address zone (doc 22 / doc 36 create rule)', () => {
    const result = customerFormSchema.safeParse({ ...form, zoneId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid phone on the add form', () => {
    const result = customerCreateSchema.safeParse({ ...form, phone: '12345' });
    expect(result.success).toBe(false);
  });

  it('requires at least one field to update and rejects a blank name on the edit form', () => {
    expect(customerUpdateSchema.safeParse({}).success).toBe(false);
    expect(customerEditFormSchema.safeParse({ ...form, name: '' }).success).toBe(false);
    expect(
      customerEditFormSchema.safeParse({ name: 'Aarti Menon', email: '', status: 'BLOCKED' })
        .success,
    ).toBe(true);
  });
});

describe('listCustomersQuerySchema', () => {
  it('defaults to page 1, pageSize 25 and -createdAt (repo list convention)', () => {
    const parsed = listCustomersQuerySchema.parse({});
    expect(parsed).toEqual({
      page: 1,
      pageSize: 25,
      sort: '-createdAt',
    });
  });

  it('rejects an unsupported sort field', () => {
    expect(listCustomersQuerySchema.safeParse({ sort: 'walletBalance' }).success).toBe(false);
  });

  it('normalises a repeatable zoneId into an array', () => {
    expect(
      requestedCustomerZoneIds({ ...listCustomersQuerySchema.parse({}), zoneId: [zoneId] }),
    ).toEqual([zoneId]);
    expect(requestedCustomerZoneIds({ ...listCustomersQuerySchema.parse({}), zoneId })).toEqual([
      zoneId,
    ]);
    expect(requestedCustomerZoneIds(listCustomersQuerySchema.parse({}))).toBeUndefined();
  });
});

describe('doc decisions locked into the contract', () => {
  it('keeps the registration source enum APP/ADMIN/REFERRAL/OTHER (doc 08 People)', () => {
    expect(CUSTOMER_SOURCES).toEqual(['APP', 'ADMIN', 'REFERRAL', 'OTHER']);
  });

  it('exposes the BLOCKED status the block/unblock endpoints move between', () => {
    expect(CUSTOMER_STATUSES).toEqual(['ACTIVE', 'INACTIVE', 'BLOCKED']);
  });

  it('contracts reveal as { phone, email } — the audited unmask (D26)', () => {
    expect(customerRevealSchema.parse({ phone: '9840012345', email: null })).toEqual({
      phone: '9840012345',
      email: null,
    });
    expect(customerRevealSchema.safeParse({ phone: '9840012345' }).success).toBe(false);
  });
});
