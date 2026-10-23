import { describe, expect, it } from 'vitest';
import type { MenuBulkPreviewResponse, MenuItemBulkInput } from '@zoauro/shared';
import { ApiError } from '../../lib/api';
import {
  applyBulkValue,
  bulkValueBody,
  classifyBulkValueError,
  EMPTY_BULK_DRAFT,
  formatBulkPreviewValue,
  previewBulkValue,
  type BulkValueDraft,
} from './bulk-value';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDS = [ID_A, ID_B];

function draft(patch: Partial<BulkValueDraft>): BulkValueDraft {
  return { ...EMPTY_BULK_DRAFT, ...patch };
}

describe('bulkValueBody — the shared discriminated union, rupees → paise at the edge', () => {
  it('builds an availability body', () => {
    const result = bulkValueBody(draft({ action: 'availability', available: false }), IDS);
    expect(result).toEqual({
      ok: true,
      body: { action: 'availability', ids: IDS, available: false },
    });
  });

  it('builds a category body and clears to null on an empty value', () => {
    expect(bulkValueBody(draft({ action: 'category', category: 'Main course' }), IDS)).toEqual({
      ok: true,
      body: { action: 'category', ids: IDS, category: 'Main course' },
    });
    expect(bulkValueBody(draft({ action: 'category', category: '  ' }), IDS)).toEqual({
      ok: true,
      body: { action: 'category', ids: IDS, category: null },
    });
  });

  it('builds a percent price body (percent XOR amount)', () => {
    const result = bulkValueBody(
      draft({ action: 'price', priceMode: 'percent', percent: '-10', amountRupees: '999' }),
      IDS,
    );
    expect(result).toEqual({ ok: true, body: { action: 'price', ids: IDS, percent: -10 } });
  });

  it('converts flat rupees to integer paise', () => {
    const result = bulkValueBody(
      draft({ action: 'price', priceMode: 'amount', amountRupees: '2.50' }),
      IDS,
    );
    expect(result).toEqual({ ok: true, body: { action: 'price', ids: IDS, amountPaise: 250 } });
  });

  it('rejects an out-of-range percent and a sub-rupee amount client-side', () => {
    expect(bulkValueBody(draft({ action: 'price', percent: '-100' }), IDS).ok).toBe(false);
    expect(
      bulkValueBody(draft({ action: 'price', priceMode: 'amount', amountRupees: '0.5' }), IDS).ok,
    ).toBe(false);
    expect(bulkValueBody(EMPTY_BULK_DRAFT, []).ok).toBe(false);
  });
});

const previewBody: MenuItemBulkInput = {
  action: 'availability',
  ids: IDS,
  available: false,
};

const previewResponse: MenuBulkPreviewResponse = {
  data: {
    action: 'availability',
    total: 2,
    rows: [
      {
        id: ID_A,
        name: 'Ghee Podi Dosa',
        before: { isAvailable: true },
        after: { isAvailable: false },
      },
      {
        id: ID_B,
        name: 'Paneer Tikka',
        before: { isAvailable: true },
        after: { isAvailable: false },
      },
    ],
  },
};

describe('preview → confirm → apply sends the identical body (D124)', () => {
  it('previews first, then applies exactly the body the preview ran on', async () => {
    const order: string[] = [];
    const data = await previewBulkValue(previewBody, async (input) => {
      order.push('preview');
      expect(input).toBe(previewBody);
      return previewResponse;
    });
    expect(data.total).toBe(2);

    const result = await applyBulkValue(previewBody, async (input) => {
      order.push('apply');
      expect(input).toBe(previewBody);
      return { data: { updated: 2, skipped: 0 } };
    });

    expect(order).toEqual(['preview', 'apply']);
    expect(result.data).toEqual({ updated: 2, skipped: 0 });
  });
});

describe('classifyBulkValueError — 404 refresh offer, 409 clash, 422 floor', () => {
  it('classifies the all-or-nothing 404', () => {
    const error = new ApiError(404, {
      code: 'NOT_FOUND',
      message: 'One or more menu items were not found',
    });
    expect(classifyBulkValueError(error)).toEqual({
      kind: 'missing',
      message: 'One or more menu items were not found',
    });
  });

  it('classifies a category conflict as 409', () => {
    const error = new ApiError(409, {
      code: 'CONFLICT',
      message: 'This category already exists for the provider',
    });
    expect(classifyBulkValueError(error).kind).toBe('conflict');
  });

  it('classifies the below-₹1 price floor as 422', () => {
    const error = new ApiError(422, {
      code: 'VALIDATION_ERROR',
      message: 'A bulk price would fall below ₹1',
    });
    expect(classifyBulkValueError(error).kind).toBe('validation');
  });

  it('falls back for non-ApiError failures', () => {
    expect(classifyBulkValueError(new Error('network'))).toEqual({
      kind: 'unknown',
      message: 'Could not apply the bulk action.',
    });
  });
});

describe('formatBulkPreviewValue', () => {
  it('formats money, booleans and null for the confirm table', () => {
    expect(formatBulkPreviewValue('price', 12_500)).toBe('₹125');
    expect(formatBulkPreviewValue('isAvailable', true)).toBe('On');
    expect(formatBulkPreviewValue('isAvailable', false)).toBe('Off');
    expect(formatBulkPreviewValue('category', null)).toBe('—');
  });
});
