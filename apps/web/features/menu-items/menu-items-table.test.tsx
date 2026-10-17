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
