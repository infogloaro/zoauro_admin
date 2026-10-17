import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/super-admin/restaurants',
}));

describe('Sidebar', () => {
  it('renders the brand block with the logo and the static SUPER ADMIN label', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toContain('GLOARO');
    expect(html).toContain('SUPER ADMIN');
    expect(html).toContain('gloaro-logo.png');
  });

  it('spans one full-height scrollbar over brand, nav and assistance box', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toMatch(/<aside[^>]*\bh-full\b[^>]*\boverflow-y-auto\b/);
    expect(html).not.toMatch(/<aside[^>]*overflow-hidden/);
    // No nested scroll region: the nav must not scroll on its own.
    expect(html).not.toMatch(/<nav[^>]*overflow-y-auto/);
    // Nothing is sticky or fixed inside the scrolling column.
    expect(html).not.toMatch(/\b(sticky|fixed)\b/);
  });

  it('places the assistance box after every nav section, inside the scroll', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html.indexOf('aria-label="Main"')).toBeGreaterThan(-1);
    expect(html.indexOf('Need Assistance?')).toBeGreaterThan(html.indexOf('aria-label="Main"'));
    expect(html).toContain('Contact Platform Support');
    expect(html).toContain('Open Help Center');
    expect(html).toContain('border-t border-white/10');
    expect(html).not.toContain('Logout');
  });

  it('has no role switcher or role options', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).not.toContain('aria-label="Admin role"');
    expect(html).not.toContain('>Super Admin<');
    expect(html).not.toContain('>Zonal Admin<');
    expect(html).not.toContain('Hotel Admin');
    expect(html).not.toContain('Hotel Food Admin');
    expect(html).not.toContain('Unavailable');
  });

  it('uses MapPin for Zone Operations and keeps live destinations', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toContain('lucide-map-pin');
    expect(html).toContain('/super-admin/restaurants');
    expect(html).toContain('/super-admin/homemakers');
    expect(html).toContain('/super-admin/zones');
  });

  it('links Hotel Room Booking and Menu / Food Items to their routes (no dead placeholders)', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toContain('Hotel Room Booking');
    expect(html).toContain('Menu / Food Items');
    // Both render as real links; a disabled placeholder has no href.
    expect(html).toContain('href="/super-admin/hotel-room-booking"');
    expect(html).toContain('href="/super-admin/menu-items"');
  });

  it('offers the collapse toggle', () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toContain('aria-label="Collapse sidebar"');
  });
});
