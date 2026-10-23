import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Homemaker, Restaurant, Vendor } from '@zoauro/shared';
import { VendorsTable } from './vendors-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/restaurants',
}));

const zone = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chennai',
  city: 'Chennai',
};

// Lists receive the API-masked phone (doc 15 / D26 masking happens server-side;
// the raw value is covered by the vendors integration test).
const restaurant: Restaurant = {
  id: '22222222-2222-4222-8222-222222222222',
  zoneId: zone.id,
  zone,
  kind: 'restaurant',
  name: 'Anna Nagar Biryani Hut',
  ownerName: 'Ravi Kumar',
  phone: '98****3210',
  email: null,
  address: '12, 2nd Avenue',
  area: 'Anna Nagar',
  lat: null,
  lng: null,
  commissionPct: 20,
  minOrder: 15000,
  fssaiNo: null,
  openingHours: null,
  status: 'PENDING',
  verificationStatus: 'PENDING',
  verificationNote: null,
  verifiedAt: null,
  verifiedBy: null,
  cuisineTags: ['Biryani', 'Chinese', 'South Indian'],
  gstNo: null,
  logoKey: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const homemaker: Homemaker = {
  id: '33333333-3333-4333-8333-333333333333',
  zoneId: zone.id,
  zone,
  kind: 'homemaker',
  name: "Meena's Kitchen",
  phone: '98****3210',
  email: null,
  address: '4, Cross Street',
  area: 'Adyar',
  lat: null,
  lng: null,
  commissionPct: null,
  minOrder: null,
  fssaiNo: null,
  openingHours: null,
  status: 'ACTIVE',
  verificationStatus: 'VERIFIED',
  verificationNote: null,
  verifiedAt: '2026-10-02T00:00:00.000Z',
  verifiedBy: 'admin-1',
  specialityTags: ['Tiffin', 'Snacks'],
  foodCategory: 'Home Food',
  experienceYears: 5,
  isAvailable: true,
  dailyCapacity: 20,
  photoKey: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const noop = () => {};

describe('VendorsTable', () => {
  it('renders the reference columns for a real record with the masked phone (D26)', () => {
    const html = renderToStaticMarkup(
      <VendorsTable
        kind="restaurant"
        vendors={[restaurant]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(html).toContain('Anna Nagar Biryani Hut');
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('98****3210');
    expect(html).not.toContain('9876543210');
    expect(html).toContain('RST-2222');
    expect(html).toContain('Chennai');
    expect(html).toContain('Anna Nagar');
    expect(html).toContain('Gross value');
    expect(html).toContain('Owner &amp; contact');
    expect(html).toContain('Pending');
    expect(html).toContain('bg-amber-100 text-amber-700');
    expect(html).toContain('—');
  });

  it('renders homemaker rows with the Provider column and the verification pill (doc 10)', () => {
    const html = renderToStaticMarkup(
      <VendorsTable kind="homemaker" vendors={[homemaker]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('Meena&#x27;s Kitchen');
    expect(html).toContain('98****3210');
    expect(html).toContain('>Provider<');
    expect(html).toContain('Active');
    expect(html).toContain('bg-green-50 text-green-700');
    expect(html).toContain('Verified');
    expect(html).toContain('>Verification<');
  });

  it('shows Rejected in the verification column while status stays Pending (doc 10 §4)', () => {
    const rejected: Vendor = {
      ...restaurant,
      status: 'PENDING',
      verificationStatus: 'REJECTED',
      verificationNote: 'FSSAI missing',
    };
    const html = renderToStaticMarkup(
      <VendorsTable kind="restaurant" vendors={[rejected]} onAction={noop} showZoneChip={false} />,
    );
    expect(html).toContain('Rejected');
    expect(html).toContain('bg-red-50 text-red-700');
  });

  it('shows the zone chip only when the scope covers several zones (doc 19)', () => {
    const withChip = renderToStaticMarkup(
      <VendorsTable kind="restaurant" vendors={[restaurant]} onAction={noop} showZoneChip />,
    );
    expect(withChip).toMatch(/rounded-full[^>]*>Chennai</);

    const withoutChip = renderToStaticMarkup(
      <VendorsTable
        kind="restaurant"
        vendors={[restaurant]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(withoutChip).toMatch(/text-text">Chennai</);
  });

  it('renders plain View/Edit action links per real row and no kebab (Figma action column)', () => {
    const html = renderToStaticMarkup(
      <VendorsTable
        kind="restaurant"
        vendors={[restaurant]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(html).toContain('title="View"');
    expect(html).toContain('title="Edit"');
    // Unverified records expose no status toggle from the list (the detail
    // dialog carries verify/reject/suspend/delete).
    expect(html).toContain('title="Verify the vendor before activating"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('More actions for');
    expect(html).not.toContain('lucide-ellipsis-vertical');
  });

  it('enables the status toggle once the vendor is verified (doc 10 §4)', () => {
    const verifiedInactive: Vendor = {
      ...restaurant,
      status: 'INACTIVE',
      verificationStatus: 'VERIFIED',
    };
    const html = renderToStaticMarkup(
      <VendorsTable
        kind="restaurant"
        vendors={[verifiedInactive]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(html).toContain('title="Activate"');
    expect(html).not.toContain('title="Verify the vendor before activating"');
  });

  it('adds a checkbox column only when bulk selection is enabled (doc 22 §bulk)', () => {
    const withoutSelection = renderToStaticMarkup(
      <VendorsTable
        kind="restaurant"
        vendors={[restaurant]}
        onAction={noop}
        showZoneChip={false}
      />,
    );
    expect(withoutSelection).not.toContain('Select all records on this page');

    const withSelection = renderToStaticMarkup(
      <VendorsTable
        kind="restaurant"
        vendors={[restaurant, homemaker as Vendor]}
        onAction={noop}
        showZoneChip={false}
        selected={new Set([restaurant.id])}
        onToggleSelected={noop}
        onToggleAll={noop}
      />,
    );
    expect(withSelection).toContain('Select all records on this page');
    expect(withSelection).toContain(`Select Anna Nagar Biryani Hut`);
    // The pre-selected row renders checked; the other one does not.
    expect(withSelection).toMatch(/checked=""/);
  });
});
