import { describe, expect, it } from 'vitest';
import { paymentQueryString, type PaymentFilters } from './api';

const base: PaymentFilters = { page: 1, pageSize: 6 };

describe('paymentQueryString', () => {
  it('always sends page and pageSize', () => {
    const qs = paymentQueryString(base);
    expect(qs).toContain('page=1');
    expect(qs).toContain('pageSize=6');
  });

  it('omits empty filters', () => {
    const qs = paymentQueryString(base);
    expect(qs).not.toContain('q=');
    expect(qs).not.toContain('status=');
    expect(qs).not.toContain('method=');
  });

  it('includes set filters and encodes values', () => {
    const qs = paymentQueryString({
      ...base,
      q: 'PAY-8F & more',
      status: 'SUCCESS',
      method: 'UPI',
    });
    expect(qs).toContain('q=PAY-8F+%26+more');
    expect(qs).toContain('status=SUCCESS');
    expect(qs).toContain('method=UPI');
  });
});
