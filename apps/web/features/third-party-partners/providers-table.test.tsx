import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ThirdPartyProvider } from '@zoauro/shared';
import { ThirdPartyProvidersTable } from './providers-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/third-party-partners',
}));

const zoneChennai = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chennai Central',
  city: 'Chennai',
};
const zoneVellore = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Vellore',
  city: 'Vellore',
};

// Contacts arrive masked server-side (D26); list rows never carry raw PII.
const active: ThirdPartyProvider = {
  id: '9a000001-0000-4000-8000-000000000001',
  name: 'SwiftShip Logistics',
  providerType: 'LOGISTICS',
  contactPerson: 'Ravi Kumar',
  contactEmail: 'ra•••@swiftship.in',
  contactPhone: '98••••4433',
  status: 'ACTIVE',
  integrationStatus: 'CONFIGURED',
  zones: [zoneChennai, zoneVellore],
  deliveriesCount: 120,
  successfulDeliveries: 108,
  failedDeliveries: 12,
  avgDeliveryMinutes: 38,
  providerCostPaise: 4_200_00,
  settlementStatus: 'PARTIAL',
  createdAt: '2026-08-01T04:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

const suspended: ThirdPartyProvider = {
  id: '9a000002-0000-4000-8000-000000000002',
  name: 'ParcelPro',
  providerType: 'AGGREGATOR',
  contactPerson: 'Meena Iyer',
  contactEmail: 'me•••@parcelpro.in',
  contactPhone: '96••••8877',
  status: 'SUSPENDED',
  integrationStatus: 'NOT_CONFIGURED',
  zones: [zoneVellore],
  deliveriesCount: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
  avgDeliveryMinutes: null,
  providerCostPaise: 0,
  settlementStatus: 'PENDING',
  createdAt: '2026-09-12T05:00:00.000Z',
  updatedAt: '2026-09-18T11:00:00.000Z',
};

const noop = () => {};

describe('ThirdPartyProvidersTable', () => {
  it('renders the reference frame columns (Company, Contract/zones, Orders, Delivered, Failed, Avg time, On-time, Fee model, Fees paid, Settlement)', () => {
    const html = renderToStaticMarkup(
      <ThirdPartyProvidersTable providers={[active]} onAction={noop} showZoneChip />,
    );
    expect(html).toContain('SwiftShip Logistics');
    expect(html).toContain('3PL-9A00');
    expect(html).toContain('LOGISTICS');
    expect(html).toContain('2 zones');
    expect(html).toContain('Chennai Central');
    expect(html).toContain('Vellore');
    expect(html).toContain('120');
    expect(html).toContain('108');
    expect(html).toContain('12');
    expect(html).toContain('38 min');
    expect(html).toContain('90.0%');
    expect(html).toContain('Manual');
    expect(html).toContain('₹4.2k');
    expect(html).toContain('Partially settled');
  });

  it('shows the empty on-time percentage and the pending settlement pill for a new provider', () => {
    const html = renderToStaticMarkup(
      <ThirdPartyProvidersTable providers={[suspended]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('ParcelPro');
    expect(html).toContain('>—<');
    expect(html).toContain('Pending');
    expect(html).toContain('bg-amber-50 text-amber-700');
    expect(html).toContain('Suspended providers must be re-activated first');
    expect(html).not.toContain('title="Disable"');
    expect(html).not.toContain('title="Enable"');
  });

  it('offers Enable for inactive providers and Disable for active ones', () => {
    const inactiveHtml = renderToStaticMarkup(
      <ThirdPartyProvidersTable
        providers={[{ ...suspended, status: 'INACTIVE' }]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(inactiveHtml).toContain('title="Enable"');

    const activeHtml = renderToStaticMarkup(
      <ThirdPartyProvidersTable providers={[active]} onAction={noop} showZoneChip={false} />,
    );
    expect(activeHtml).toContain('title="Disable"');
  });

  it('lists the covered zone names in the Contract / zones cell (doc 19)', () => {
    const html = renderToStaticMarkup(
      <ThirdPartyProvidersTable providers={[active]} onAction={noop} showZoneChip />,
    );
    expect(html).toContain('Chennai Central');
    expect(html).toContain('Vellore');
  });
});
