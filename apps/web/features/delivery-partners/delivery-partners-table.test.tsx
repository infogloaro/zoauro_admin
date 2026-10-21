import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DeliveryPartner } from '@zoauro/shared';
import { DeliveryPartnersTable } from './delivery-partners-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/delivery-partners',
}));

const zoneChennai = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chennai Central',
  city: 'Chennai',
};

// Lists receive the API-masked phone (doc 15 / D26 masking happens server-side).
const onDuty: DeliveryPartner = {
  id: 'd1000001-0000-4000-8000-000000000001',
  zoneId: zoneChennai.id,
  zone: zoneChennai,
  name: 'Karthik Raja',
  phone: '98••••1212',
  vehicleType: 'BIKE',
  vehicleNo: 'TN 09 AB 1234',
  area: 'Velachery',
  status: 'ACTIVE',
  isOnline: true,
  forceOfflineUntil: null,
  verifiedAt: '2026-09-04T06:00:00.000Z',
  currentOrders: 3,
  cashInHand: 1_840_00,
  ratingAvg: 4.7,
  deliveriesCount: 812,
  ordersAssigned: 840,
  failedDeliveries: 28,
  avgDeliveryMinutes: 31,
  onTimePct: 94,
  earningsPaise: 1_624_000,
  settlementStatus: 'PENDING',
  createdAt: '2026-08-20T04:00:00.000Z',
  updatedAt: '2026-10-06T10:15:00.000Z',
};

const pending: DeliveryPartner = {
  id: 'd3000003-0000-4000-8000-000000000003',
  zoneId: zoneChennai.id,
  zone: zoneChennai,
  name: 'Anitha Devi',
  phone: '96••••5656',
  vehicleType: 'SCOOTER',
  vehicleNo: 'TN 38 EF 9012',
  area: 'Gandhipuram',
  status: 'PENDING_VERIFICATION',
  isOnline: false,
  forceOfflineUntil: null,
  verifiedAt: null,
  currentOrders: 0,
  cashInHand: 0,
  ratingAvg: null,
  deliveriesCount: 0,
  ordersAssigned: 0,
  failedDeliveries: 0,
  avgDeliveryMinutes: null,
  onTimePct: null,
  earningsPaise: 0,
  settlementStatus: 'PENDING',
  createdAt: '2026-10-02T05:45:00.000Z',
  updatedAt: '2026-10-02T05:45:00.000Z',
};

const noop = () => {};

describe('DeliveryPartnersTable', () => {
  it('renders the reference columns for a real record with the masked phone (D26)', () => {
    const html = renderToStaticMarkup(
      <DeliveryPartnersTable partners={[onDuty]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('Karthik Raja');
    expect(html).toContain('PTR-D100');
    expect(html).toContain('98••••1212');
    expect(html).not.toContain('984001212');
    expect(html).toContain('TN 09 AB 1234');
    expect(html).toContain('Chennai Central');
    expect(html).toContain('Velachery');
    expect(html).toContain('BIKE');
    expect(html).toContain('On duty');
    expect(html).toContain('bg-green-50 text-green-700');
    expect(html).toContain('840');
    expect(html).toContain('812');
    expect(html).toContain('28');
    expect(html).toContain('31 min');
    expect(html).toContain('94%');
    expect(html).toContain('4.7 ★');
    expect(html).toContain('₹16,240');
    expect(html).toContain('Pending');
    expect(html).toContain('Active');
    expect(html).not.toContain('₹1,840');
  });

  it('renders the pending review pill with an empty rating (doc 10 §5)', () => {
    const html = renderToStaticMarkup(
      <DeliveryPartnersTable partners={[pending]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('Pending');
    expect(html).toContain('bg-amber-100 text-amber-700');
    expect(html).toContain('Off duty');
    expect(html).toContain('0');
    expect(html).toContain('>—<');
    expect(html).toContain('Pending');
    expect(html).not.toContain('bg-green-50 text-green-700');
  });

  it('keeps force offline available for on-duty rows and inert when off duty', () => {
    const activeHtml = renderToStaticMarkup(
      <DeliveryPartnersTable partners={[onDuty]} onAction={noop} showZoneChip={false} />,
    );
    expect(activeHtml).toContain('title="Force offline"');
    expect(activeHtml).toContain('title="View"');
    expect(activeHtml).toContain('title="Edit"');

    const offlineHtml = renderToStaticMarkup(
      <DeliveryPartnersTable partners={[pending]} onAction={noop} showZoneChip={false} />,
    );
    expect(offlineHtml).toContain('title="Already off duty"');
    expect(offlineHtml).toContain('cursor-not-allowed');
    expect(offlineHtml).not.toContain('title="Force offline"');
  });

  it('shows the zone chip only when the scope covers several zones (doc 19)', () => {
    const withChip = renderToStaticMarkup(
      <DeliveryPartnersTable partners={[onDuty]} onAction={noop} showZoneChip />,
    );
    expect(withChip).toMatch(/rounded-full[^>]*>Chennai Central</);

    const withoutChip = renderToStaticMarkup(
      <DeliveryPartnersTable partners={[onDuty]} onAction={noop} showZoneChip={false} />,
    );
    expect(withoutChip).toMatch(/text-text">Chennai Central</);
  });
});
