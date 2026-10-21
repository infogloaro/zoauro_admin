import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/customers',
  useSearchParams: () => new URLSearchParams(''),
}));

import { customerKpis } from './customers-screen';

const counts = { total: 128, active: 100, blocked: 8, inactive: 20 };

describe('customerKpis', () => {
  it('lists the six KPI cards in exactly the specified order', () => {
    const labels = customerKpis(counts, false).map((kpi) => kpi.label);
    expect(labels).toEqual([
      'Registered Customers',
      'New Customers',
      'Returning',
      'Lifetime Spend',
      'Average Order Value',
      'Satisfaction',
    ]);
  });

  it('reads Registered Customers from the list counts and leaves the unsupported KPIs honest', () => {
    const kpis = customerKpis(counts, false);
    expect(kpis[0]?.value).toBe('128');
    expect(kpis[0]?.caption).toBe('Across every zone');
    for (const kpi of kpis.slice(1)) {
      expect(kpi.value).toBe('—');
      expect(kpi.caption).toBe('Awaiting API data');
    }
  });

  it('shows the loading caption while the list is pending and 0 before counts arrive', () => {
    const kpis = customerKpis(undefined, true);
    expect(kpis[0]?.value).toBe('0');
    expect(kpis[0]?.caption).toBe('Loading…');
  });

  it('attaches an icon to every card', () => {
    const kpis = customerKpis(counts, false);
    expect(kpis).toHaveLength(6);
    expect(kpis.every((kpi) => kpi.Icon !== undefined)).toBe(true);
  });
});
