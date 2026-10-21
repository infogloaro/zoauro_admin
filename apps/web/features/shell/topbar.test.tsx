import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '@zoauro/shared';
import { PROFILE_MENU, Topbar } from './topbar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/super-admin/restaurants',
}));

const user: Me = {
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'Ada Lovelace',
  email: 'ada@zoauro.in',
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  zones: [],
};

describe('PROFILE_MENU', () => {
  it('lists Profile & Settings, Account Activity, then Logout', () => {
    expect(PROFILE_MENU.map((item) => item.label)).toEqual([
      'Profile & Settings',
      'Account Activity',
      'Logout',
    ]);
  });

  it('keeps the accent colours and only Logout actionable', () => {
    expect(PROFILE_MENU.filter((item) => !item.danger).every((item) => !item.available)).toBe(true);
    expect(PROFILE_MENU.filter((item) => item.danger).map((item) => item.id)).toEqual(['logout']);
    expect(PROFILE_MENU.find((item) => item.id === 'logout')?.available).toBe(true);
    expect(PROFILE_MENU[0]?.className).toContain('text-menu-profile');
    expect(PROFILE_MENU[1]?.className).toContain('text-menu-activity');
    expect(PROFILE_MENU[2]?.className).toContain('text-red-600');
  });
});

describe('Topbar', () => {
  it('renders the fixed SA avatar with the role label and email', () => {
    const html = renderToStaticMarkup(<Topbar user={user} />);
    expect(html).toContain('>SA<');
    expect(html).toContain('Super Admin');
    expect(html).toContain('ada@zoauro.in');
    expect(html).not.toContain('Ada Lovelace');
  });

  it('offers the four role options and labels the page from the route', () => {
    const html = renderToStaticMarkup(<Topbar user={user} />);
    expect(html).toContain('Restaurant Management');
    expect(html).toContain('>Zonal Admin<');
    expect(html).toContain('>Hotel Admin<');
    expect(html).toContain('>Home Food Admin<');
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain('aria-label="Global search"');
  });

  it('renders the notification bell', () => {
    const html = renderToStaticMarkup(<Topbar user={user} />);
    expect(html).toContain('aria-label="Notifications"');
  });
});
