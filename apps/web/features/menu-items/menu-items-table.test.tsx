import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@zoauro/shared';
import { menuActionsFor, MenuItemsTable } from './menu-items-table';

const zone = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Anna Nagar',
  city: 'Chennai',
};

function item(overrides: Partial<MenuItem>): MenuItem {
  return {
    kind: 'menu-item',
    id: '22222222-2222-4222-8222-222222222222',
    zoneId: zone.id,
    zone,
    vendorType: 'restaurant',
    vendorId: '33333333-3333-4333-8333-333333333333',
    vendorName: 'The Marina Table',
    name: 'Ghee Podi Dosa',
    description: 'Crisp dosa with podi and ghee',
    category: 'South Indian',
    price: 12_000,
    stock: null,
    isAvailable: true,
    isFeatured: false,
    imageKey: null,
    adminDisabled: false,
    adminOverrideAt: null,
    live: true,
    dietary: 'NON_VEG',
    approvalStatus: 'PENDING',
    rejectionReason: null,
    approvedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

describe('MenuItemsTable', () => {
  it('renders the selected row with name, provider, zone, price and status', () => {
    const html = renderToStaticMarkup(<MenuItemsTable items={[item({})]} onAction={noop} />);
    expect(html).toContain('Ghee Podi Dosa');
    expect(html).toContain('South Indian');
    expect(html).toContain('The Marina Table');
    expect(html).toContain('Anna Nagar');
    expect(html).toContain('₹120');
    expect(html).toContain('Pending');
  });

  it('renders rows for different statuses side by side without conflating them', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable
        items={[
          item({ id: 'a', name: 'Pending Dish', approvalStatus: 'PENDING' }),
          item({ id: 'b', name: 'Approved Dish', approvalStatus: 'APPROVED' }),
          item({ id: 'c', name: 'Rejected Dish', approvalStatus: 'REJECTED' }),
        ]}
        onAction={noop}
      />,
    );
    expect(html).toContain('Pending Dish');
    expect(html).toContain('Approved Dish');
    expect(html).toContain('Rejected Dish');
    expect(html).toContain('>Pending<');
    expect(html).toContain('>Approved<');
    expect(html).toContain('>Rejected<');
  });

  it('shows the rejection reason chip context as the status label only (reason lives in View)', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable
        items={[item({ approvalStatus: 'REJECTED', rejectionReason: 'Blurry photo' })]}
        onAction={noop}
      />,
    );
    expect(html).toContain('>Rejected<');
  });
});

describe('menuActionsFor — only workflow-legal actions are offered (doc 10 §4)', () => {
  it('offers review actions on a PENDING item', () => {
    expect(menuActionsFor('PENDING')).toEqual([
      'view',
      'edit',
      'approve',
      'reject',
      'archive',
      'delete',
    ]);
  });

  it('hides reject on APPROVED items (APPROVED → ARCHIVED only)', () => {
    expect(menuActionsFor('APPROVED')).toEqual(['view', 'edit', 'archive', 'delete']);
  });

  it('offers re-approve on REJECTED items (REJECTED → APPROVED re-review)', () => {
    expect(menuActionsFor('REJECTED')).toEqual(['view', 'edit', 'approve', 'archive', 'delete']);
  });

  it('offers restore on ARCHIVED items and never archive or reject again', () => {
    expect(menuActionsFor('ARCHIVED')).toEqual(['view', 'edit', 'approve', 'delete']);
  });
});

describe('stock, live status and admin disable affordances (D126)', () => {
  it('renders an empty stock editor for an untracked item and the number when tracked', () => {
    const untracked = renderToStaticMarkup(
      <MenuItemsTable items={[item({ stock: null })]} onAction={noop} onStockChange={noop} />,
    );
    expect(untracked).toContain('Stock for Ghee Podi Dosa (empty = not tracked)');
    const tracked = renderToStaticMarkup(
      <MenuItemsTable items={[item({ stock: 12 })]} onAction={noop} onStockChange={noop} />,
    );
    expect(tracked).toContain('value="12"');
  });

  it('shows a plain Untracked label when no stock editor is wired', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable items={[item({ stock: null })]} onAction={noop} />,
    );
    expect(html).toContain('Untracked');
    expect(html).not.toContain('type="number"');
  });

  it('shows the server-computed live badge and an Admin disabled badge', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable items={[item({ live: false, adminDisabled: true })]} onAction={noop} />,
    );
    expect(html).toContain('>Not live<');
    expect(html).toContain('>Admin disabled<');
  });

  it('shows the admin override hint when a vendor-owned field was overridden', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable
        items={[item({ adminOverrideAt: '2026-07-02T10:00:00.000Z' })]}
        onAction={noop}
      />,
    );
    expect(html).toContain('Admin override');
  });

  it('offers the availability and admin-disable toggles only when handlers are wired', () => {
    const withToggles = renderToStaticMarkup(
      <MenuItemsTable
        items={[item({ isAvailable: true, adminDisabled: false })]}
        onAction={noop}
        onAvailabilityToggle={noop}
        onAdminDisableToggle={noop}
      />,
    );
    expect(withToggles).toContain('title="Hide from customers"');
    expect(withToggles).toContain('Admin disable');
    const without = renderToStaticMarkup(<MenuItemsTable items={[item({})]} onAction={noop} />);
    expect(without).not.toContain('Hide from customers');
    expect(without).not.toContain('Admin-disable');
  });

  it('shows the featured star toggle when a handler is wired', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable
        items={[item({ isFeatured: true })]}
        onAction={noop}
        onFeaturedToggle={noop}
      />,
    );
    expect(html).toContain('Unfeature Ghee Podi Dosa');
  });
});

describe('sortable headers (shared sort schema: -?(createdAt|name|price))', () => {
  it('renders sort buttons for the food item, price and created columns', () => {
    const html = renderToStaticMarkup(
      <MenuItemsTable items={[item({})]} onAction={noop} sort="-createdAt" onSort={noop} />,
    );
    expect(html).toContain('aria-label="Sort by Food Item"');
    expect(html).toContain('aria-label="Sort by Price"');
    expect(html).toContain('aria-label="Sort by Created"');
  });

  it('falls back to plain headers when no sort handler is wired', () => {
    const html = renderToStaticMarkup(<MenuItemsTable items={[item({})]} onAction={noop} />);
    expect(html).not.toContain('Sort by');
  });
});
