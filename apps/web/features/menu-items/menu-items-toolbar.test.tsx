import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MENU_AVAILABILITY_FILTERS } from '@zoauro/shared';
import { MenuItemsToolbar, MENU_AVAILABILITY_LABELS } from './menu-items-toolbar';

const base = {
  value: { q: '', status: '', zoneId: '', vendorType: '', dietary: '' },
  zones: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Anna Nagar' }],
  categories: ['South Indian', 'Snacks'],
  onChange: () => {},
  onExport: () => {},
};

describe('MenuItemsToolbar — availability, featured and category filters', () => {
  it('renders the More Filters toggle that hosts availability, featured and category', () => {
    const html = renderToStaticMarkup(<MenuItemsToolbar {...base} />);
    // The three selects live in the More Filters panel (closed in SSR).
    expect(html).toContain('More Filters');
    expect(html).toContain('aria-expanded="false"');
  });

  it('humanises every documented availability filter', () => {
    for (const filter of MENU_AVAILABILITY_FILTERS) {
      expect(MENU_AVAILABILITY_LABELS[filter]).toBeTruthy();
    }
    expect(MENU_AVAILABILITY_LABELS.live).toBe('Live');
    expect(MENU_AVAILABILITY_LABELS.out_of_stock).toBe('Out of stock');
    expect(MENU_AVAILABILITY_LABELS.vendor_off).toBe('Vendor turned off');
    expect(MENU_AVAILABILITY_LABELS.admin_disabled).toBe('Admin disabled');
  });

  it('accepts the new URL-backed filter values without breaking the layout', () => {
    const html = renderToStaticMarkup(
      <MenuItemsToolbar
        {...base}
        value={{
          ...base.value,
          availability: 'out_of_stock',
          featured: 'true',
          category: 'Snacks',
        }}
      />,
    );
    expect(html).toContain('Search menu items');
    expect(html).toContain('Export CSV');
  });
});
