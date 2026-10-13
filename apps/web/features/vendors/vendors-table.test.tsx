import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Homemaker, Restaurant } from '@zoauro/shared';
import { VendorsPagination, VendorsTable } from './vendors-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/restaurants',
}));

const zone = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chennai',
  city: 'Chennai',
};

const restaurant: Restaurant = {
  id: '22222222-2222-4222-8222-222222222222',
  zoneId: zone.id,
  zone,
  kind: 'restaurant',
  name: 'Anna Nagar Biryani Hut',
  ownerName: 'Ravi Kumar',
  phone: '+919876543210',
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
  phone: '+919812345678',
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

describe('VendorsTable', () => {
  it('renders avatar, owner, area, verification and status without phone (Figma 133854, D26)', () => {
    const html = renderToStaticMarkup(
      <VendorsTable
        vendors={[restaurant]}
        sort="-createdAt"
        onSort={() => {}}
        onAction={() => {}}
        showZoneChip={false}
      />,
    );
    expect(html).toContain('Anna Nagar Biryani Hut');
    expect(html).toContain('Ravi Kumar');
    expect(html).not.toContain('+919876543210');
    expect(html).toContain('#2222');
    expect(html).toContain('Anna Nagar');
    expect(html).toContain('Pending review');
    expect(html).toContain('Pending');
    expect(html).toContain('Biryani, Chinese +1');
  });

  it('renders homemaker specialities without an owner column', () => {
    const html = renderToStaticMarkup(
      <VendorsTable
        vendors={[homemaker]}
        sort="-createdAt"
        onSort={() => {}}
        onAction={() => {}}
        showZoneChip={false}
      />,
    );
    expect(html).toContain('Meena&#x27;s Kitchen');
    expect(html).not.toContain('+919812345678');
    expect(html).not.toContain('>Owner</');
    expect(html).toContain('Tiffin, Snacks');
    expect(html).toContain('Verified');
    expect(html).toContain('Active');
  });

  it('shows the zone chip only when the scope covers several zones (doc 19)', () => {
    const withChip = renderToStaticMarkup(
      <VendorsTable
        vendors={[restaurant]}
        sort="-createdAt"
        onSort={() => {}}
        onAction={() => {}}
        showZoneChip
      />,
    );
    expect(withChip).toMatch(/rounded-full[^>]*>Chennai</);

    const withoutChip = renderToStaticMarkup(
      <VendorsTable
        vendors={[restaurant]}
        sort="-createdAt"
        onSort={() => {}}
        onAction={() => {}}
        showZoneChip={false}
      />,
    );
    expect(withoutChip).toMatch(/class="text-muted">Chennai</);
  });

  it('renders the kebab action menu per row (Figma: action column)', () => {
    const html = renderToStaticMarkup(
      <VendorsTable
        vendors={[restaurant]}
        sort="-createdAt"
        onSort={() => {}}
        onAction={() => {}}
        showZoneChip={false}
      />,
    );
    expect(html).toContain('More actions for Anna Nagar Biryani Hut');
    expect(html).toContain('lucide-ellipsis-vertical');
  });
});

describe('VendorsPagination', () => {
  it('shows the range and total with the tab noun (doc 20, Figma range format)', () => {
    const restaurants = renderToStaticMarkup(
      <VendorsPagination
        page={1}
        pageSize={25}
        total={30}
        noun="restaurants"
        onPage={() => {}}
        onPageSize={() => {}}
      />,
    );
    expect(restaurants).toContain('Showing 1-25 of 30 restaurants');

    const homemakers = renderToStaticMarkup(
      <VendorsPagination
        page={1}
        pageSize={25}
        total={5}
        noun="homemakers"
        onPage={() => {}}
        onPageSize={() => {}}
      />,
    );
    expect(homemakers).toContain('Showing 1-5 of 5 homemakers');
  });

  it('disables prev on the first page and next on the last', () => {
    const first = renderToStaticMarkup(
      <VendorsPagination
        page={1}
        pageSize={25}
        total={30}
        noun="restaurants"
        onPage={() => {}}
        onPageSize={() => {}}
      />,
    );
    expect(first).toContain('disabled=""');
    const last = renderToStaticMarkup(
      <VendorsPagination
        page={2}
        pageSize={25}
        total={30}
        noun="restaurants"
        onPage={() => {}}
        onPageSize={() => {}}
      />,
    );
    expect(last).toContain('aria-current="page"');
  });

  it('offers the rows-per-page selector (Figma: N / page)', () => {
    const html = renderToStaticMarkup(
      <VendorsPagination
        page={1}
        pageSize={10}
        total={30}
        noun="restaurants"
        onPage={() => {}}
        onPageSize={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Rows per page"');
  });
});
