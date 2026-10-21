import { describe, expect, it } from 'vitest';
import { csvRow, paymentKpis, paymentsListState } from './payments-screen';

describe('paymentKpis', () => {
  it('lists the six KPI cards in the specified order', () => {
    const labels = paymentKpis(undefined, false).map((kpi) => kpi.label);
    expect(labels).toEqual([
      'Total Transactions',
      'Successful',
      'Pending',
      'Failed',
      'Total Collected',
      'Total Refunded',
    ]);
  });

  it('reads Total Transactions from meta.total and leaves the unsupported KPIs honest', () => {
    const kpis = paymentKpis({ page: 1, pageSize: 6, total: 42 }, false);
    expect(kpis[0]?.value).toBe('42');
    expect(kpis[0]?.caption).toBe('All payment transactions');
    for (const kpi of kpis.slice(1)) {
      expect(kpi.value).toBe('—');
      expect(kpi.caption).toBe('Awaiting API data');
    }
  });

  it('shows the loading caption while the list is pending and 0 before counts arrive', () => {
    const pending = paymentKpis(undefined, true);
    expect(pending[0]?.value).toBe('0');
    expect(pending[0]?.caption).toBe('Loading…');
  });

  it('attaches an icon to every card', () => {
    const kpis = paymentKpis(undefined, false);
    expect(kpis).toHaveLength(6);
    expect(kpis.every((kpi) => kpi.Icon !== undefined)).toBe(true);
  });
});

describe('paymentsListState', () => {
  it('shows loading while the query is pending, even with filters set', () => {
    expect(paymentsListState({ isPending: true, isError: false, total: 0, hasFilters: true })).toBe(
      'loading',
    );
  });

  it('shows the error state over empty results when the query failed', () => {
    expect(
      paymentsListState({ isPending: false, isError: true, total: 0, hasFilters: false }),
    ).toBe('error');
  });

  it('distinguishes the empty list from a filtered no-results state', () => {
    expect(
      paymentsListState({ isPending: false, isError: false, total: 0, hasFilters: false }),
    ).toBe('empty');
    expect(
      paymentsListState({ isPending: false, isError: false, total: 0, hasFilters: true }),
    ).toBe('no-results');
  });

  it('renders the table once rows exist', () => {
    expect(
      paymentsListState({ isPending: false, isError: false, total: 3, hasFilters: false }),
    ).toBe('data');
  });
});

describe('csvRow', () => {
  it('quotes commas and doubles embedded quotes', () => {
    expect(csvRow(['a,b'])).toBe('"a,b"');
    expect(csvRow(['say "hi"'])).toBe('"say ""hi"""');
  });

  it('stringifies numbers and joins the cells', () => {
    expect(csvRow(['UPI', 42])).toBe('"UPI","42"');
  });
});
