import { describe, expect, it } from 'vitest';
import type { DashboardSummary } from '@zoauro/shared';
import { dashboardKpis, greetingFor, registrationsListState } from './dashboard-screen';

const SUMMARY: DashboardSummary = {
  customers: 128,
  restaurants: 42,
  activeRestaurants: 30,
  homemakers: 17,
  deliveryPartners: 23,
  pendingVerification: 9,
  suspended: 4,
  platformHealth: { pendingVerifications: 9, activeSessions: 6 },
};

describe('dashboardKpis', () => {
  it('lists the twelve doc-20 KPI cards in the specified order', () => {
    const labels = dashboardKpis(SUMMARY, false).map((kpi) => kpi.label);
    expect(labels).toEqual([
      'Total Orders',
      'Total Customers',
      'Total Restaurants',
      'Active Restaurants',
      'Pending Verification',
      'Suspended',
      'Total Revenue',
      'Platform Commission',
      'Restaurant Payouts',
      'Total Refunds',
      'Avg Order Value',
      'Cancellation Rate',
    ]);
  });

  it('fills the six DB-provable KPIs from the summary and leaves the order/finance half honest', () => {
    const kpis = dashboardKpis(SUMMARY, false);
    const byLabel = Object.fromEntries(kpis.map((kpi) => [kpi.label, kpi]));

    expect(byLabel['Total Customers']?.value).toBe('128');
    expect(byLabel['Total Restaurants']?.value).toBe('42');
    expect(byLabel['Active Restaurants']?.value).toBe('30');
    expect(byLabel['Pending Verification']?.value).toBe('9');
    expect(byLabel['Suspended']?.value).toBe('4');

    for (const label of [
      'Total Orders',
      'Total Revenue',
      'Platform Commission',
      'Restaurant Payouts',
      'Total Refunds',
      'Avg Order Value',
      'Cancellation Rate',
    ]) {
      expect(byLabel[label]?.value).toBe('—');
      expect(byLabel[label]?.caption).toMatch(/Requires/);
    }
  });

  it('shows the loading caption for real KPIs while the summary is pending', () => {
    const kpis = dashboardKpis(undefined, true);
    const customers = kpis.find((kpi) => kpi.label === 'Total Customers');
    expect(customers?.value).toBe('0');
    expect(customers?.caption).toBe('Loading…');
    const orders = kpis.find((kpi) => kpi.label === 'Total Orders');
    expect(orders?.value).toBe('—');
  });

  it('attaches an icon to every card', () => {
    const kpis = dashboardKpis(SUMMARY, false);
    expect(kpis).toHaveLength(12);
    expect(kpis.every((kpi) => kpi.Icon !== undefined)).toBe(true);
  });
});

describe('registrationsListState', () => {
  it('shows loading while the query is pending', () => {
    expect(registrationsListState({ isPending: true, isError: false, total: 0 })).toBe('loading');
  });

  it('shows the error state over empty results when the query failed', () => {
    expect(registrationsListState({ isPending: false, isError: true, total: 0 })).toBe('error');
  });

  it('distinguishes the empty state from ready', () => {
    expect(registrationsListState({ isPending: false, isError: false, total: 0 })).toBe('empty');
    expect(registrationsListState({ isPending: false, isError: false, total: 3 })).toBe('ready');
  });
});

describe('greetingFor', () => {
  it('greets by time of day with the user name', () => {
    expect(greetingFor('Asha', new Date('2026-06-10T08:00:00'))).toBe('Good morning, Asha');
    expect(greetingFor('Asha', new Date('2026-06-10T14:00:00'))).toBe('Good afternoon, Asha');
    expect(greetingFor('Asha', new Date('2026-06-10T20:00:00'))).toBe('Good evening, Asha');
  });
});
