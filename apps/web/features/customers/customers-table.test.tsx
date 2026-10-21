import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Customer } from '@zoauro/shared';
import { CustomersTable } from './customers-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/customers',
}));

const zoneChennai = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chennai Central',
  city: 'Chennai',
};

const zoneCoimbatore = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Coimbatore North',
  city: 'Coimbatore',
};

// Lists receive the API-masked contact (doc 15 / D26 masking happens
// server-side; the reveal endpoint is covered by the preview/integration tests).
const active: Customer = {
  id: 'c1000001-0000-4000-8000-000000000001',
  name: 'Aarti Menon',
  phone: '98••••1111',
  email: 'aar•••@example.in',
  status: 'ACTIVE',
  source: 'APP',
  userType: 'CUSTOMER',
  walletBalance: 1_25_000,
  orderCount: 42,
  totalSpentPaise: 84_500_00,
  zones: [zoneChennai],
  createdAt: '2026-08-14T05:20:00.000Z',
  updatedAt: '2026-10-02T09:10:00.000Z',
};

const blockedMultiZone: Customer = {
  id: 'c2000002-0000-4000-8000-000000000002',
  name: 'Rahul Verma',
  phone: '97••••2222',
  email: null,
  status: 'BLOCKED',
  source: 'REFERRAL',
  userType: 'CUSTOMER',
  walletBalance: 0,
  orderCount: 17,
  totalSpentPaise: 32_750_00,
  zones: [zoneChennai, zoneCoimbatore],
  createdAt: '2026-09-01T11:45:00.000Z',
  updatedAt: '2026-09-28T07:05:00.000Z',
};

const noop = () => {};

describe('CustomersTable', () => {
  it('renders the reference columns for a real record with the masked contact (D26)', () => {
    const html = renderToStaticMarkup(
      <CustomersTable customers={[active]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('Aarti Menon');
    expect(html).toContain('CUS-C100');
    expect(html).toContain('>AM<');
    expect(html).toContain('98••••1111');
    expect(html).not.toContain('9840011111');
    expect(html).toContain('aar•••@example.in');
    // Frame order: email is the primary line, the phone sits below it.
    expect(html.indexOf('aar•••@example.in')).toBeLessThan(html.indexOf('98••••1111'));
    expect(html).toContain('Joined');
    expect(html).toContain('14 Aug 2026');
    expect(html).toContain('Chennai Central');
    expect(html).toContain('42');
    expect(html).toContain('₹84,500');
    expect(html).toContain('App');
    expect(html).toContain('Active');
    expect(html).toContain('bg-green-50 text-green-700');
  });

  it('shows the Unblock toggle on a blocked row and Block on an active one', () => {
    const blockedHtml = renderToStaticMarkup(
      <CustomersTable customers={[blockedMultiZone]} onAction={noop} showZoneChip={false} />,
    );
    expect(blockedHtml).toContain('title="Unblock"');
    expect(blockedHtml).toContain('>ON<');
    expect(blockedHtml).toMatch(/bg-amber-100 text-amber-700">Blocked</);

    const activeHtml = renderToStaticMarkup(
      <CustomersTable customers={[active]} onAction={noop} showZoneChip={false} />,
    );
    expect(activeHtml).toContain('title="Block"');
    expect(activeHtml).toContain('>OFF<');
  });

  it('maps status to the reference frame pill colours (green/red/amber)', () => {
    const activeHtml = renderToStaticMarkup(
      <CustomersTable customers={[active]} onAction={noop} showZoneChip={false} />,
    );
    expect(activeHtml).toMatch(/bg-green-50 text-green-700">Active</);

    const inactiveHtml = renderToStaticMarkup(
      <CustomersTable
        customers={[{ ...active, status: 'INACTIVE' as const }]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(inactiveHtml).toMatch(/bg-red-50 text-red-700">Inactive</);
  });

  it('counts extra zones in the zone cell', () => {
    const html = renderToStaticMarkup(
      <CustomersTable customers={[blockedMultiZone]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('+1 more zone');
  });

  it('shows the zone chip only when the scope covers several zones (doc 19)', () => {
    const withChip = renderToStaticMarkup(
      <CustomersTable customers={[active]} onAction={noop} showZoneChip />,
    );
    expect(withChip).toMatch(/rounded-full[^>]*>Chennai Central</);

    const withoutChip = renderToStaticMarkup(
      <CustomersTable customers={[active]} onAction={noop} showZoneChip={false} />,
    );
    expect(withoutChip).toMatch(/text-text">Chennai Central</);
  });

  it('renders plain View/Edit actions per row and no kebab (Figma action column)', () => {
    const html = renderToStaticMarkup(
      <CustomersTable customers={[active]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('title="View"');
    expect(html).toContain('title="Edit"');
    expect(html).not.toContain('lucide-ellipsis-vertical');
  });
});
