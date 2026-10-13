import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRupees } from './format';

describe('formatRupees', () => {
  it('formats paise with Indian grouping (doc 19 §9)', () => {
    expect(formatRupees(124832000)).toBe('₹12,48,320');
  });

  it('formats zero and small amounts', () => {
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(4900)).toBe('₹49');
    expect(formatRupees(4999)).toBe('₹50');
  });
});

describe('formatDateTime', () => {
  it('renders "09 Oct 2026, 14:30" in UTC', () => {
    expect(formatDateTime('2026-10-09T14:30:00Z')).toBe('09 Oct 2026, 14:30');
  });
});
