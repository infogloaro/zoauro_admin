import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@zoauro/shared';
import { menuFor } from '../../lib/navigation';
import { Sidebar } from './Sidebar';
import { signOut } from './UserMenu';
import { zoneChipLabel } from './ZoneChip';

// P14 (doc 56): the shell's rendering and the protected layout, with Next's navigation and the session mocked.

class Interrupt extends Error {}
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Interrupt(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Interrupt('not-found');
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: nav.redirect,
  notFound: nav.notFound,
  usePathname: () => '/super-admin/dashboard',
}));
// the header search calls the API (its own tests in global-search.test.tsx); here only that the shell mounts it
vi.mock('./PageSearch', () => ({
  PageSearch: ({ userRole }: { userRole: string }) => <span>{`search:${userRole}`}</span>,
}));
// the menu badges call the API (their own test below uses the Sidebar's counts prop)
vi.mock('./usePendingCounts', () => ({ usePendingCounts: () => ({}) }));
// "My reviews" calls the API (claims tests); here only that the shell mounts it
vi.mock('../../features/claims/MyReviews', () => ({
  MyReviews: ({ userRole }: { userRole: string }) => <span>{`reviews:${userRole}`}</span>,
}));
// the zone switcher has its own tests (zone-switcher.test.tsx); here only that the shell mounts it for each role
vi.mock('./ZoneSwitcher', () => ({
  ZoneSwitcher: ({ role, zones }: { role: string; zones: unknown[] }) => (
    <span>{`switcher:${role}:${zones.length}`}</span>
  ),
}));
const session = vi.hoisted(() => ({ me: null as MeResponse | null, path: '/' }));
vi.mock('../../lib/server-session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/server-session')>();
  return { ...real, getMe: async () => session.me, requestPath: async () => session.path };
});
const { ProtectedArea } = await import('./ProtectedArea');

const me = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN', zoneCount = 1): MeResponse => ({
  user: {
    id: '0192f1d2-0000-7000-8000-0000000000aa',
    name: 'Asha Rao',
    email: 'a@example.test',
    role,
  },
  mustChangePassword: false,
  csrfToken: 'csrf-token',
  permissions:
    role === 'SUPER_ADMIN'
      ? { global: true }
      : {
          global: false,
          zones: Array.from({ length: zoneCount }, (_, i) => ({
            zoneId: `0192f1d2-0000-7000-8000-00000000000${i}`,
            name: `Chennai ${i}`,
            code: `CH${i}`,
            colorHex: '#2563EB',
            status: 'ACTIVE' as const,
            permissions: ['orders:view' as const],
            limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
          })),
        },
  mfa: { enabled: true, required: true, enrolmentNeeded: false },
});

async function renderArea(area: 'super-admin' | 'zone' | 'shared', path: string) {
  session.path = path;
  try {
    return {
      html: renderToStaticMarkup(await ProtectedArea({ area, children: <p>page body</p> })),
    };
  } catch (e) {
    if (e instanceof Interrupt) return { interrupt: e.message };
    throw e;
  }
}

beforeEach(() => {
  nav.redirect.mockClear();
  nav.notFound.mockClear();
});

describe('protected layouts (server-side, every request)', () => {
  it('signed out: every area redirects to /login?next=<path>; nothing renders', async () => {
    session.me = null;
    expect(await renderArea('super-admin', '/super-admin/zones')).toEqual({
      interrupt: 'redirect:/login?next=%2Fsuper-admin%2Fzones',
    });
    expect(await renderArea('zone', '/zone/dashboard')).toEqual({
      interrupt: 'redirect:/login?next=%2Fzone%2Fdashboard',
    });
    expect(await renderArea('shared', '/account/security')).toEqual({
      interrupt: 'redirect:/login?next=%2Faccount%2Fsecurity',
    });
  });

  it('Zonal Admin on /super-admin: 404; Super Admin on /zone: the 403 page without the shell', async () => {
    session.me = me('ZONAL_ADMIN');
    expect(await renderArea('super-admin', '/super-admin/dashboard')).toEqual({
      interrupt: 'not-found',
    });
    session.me = me('SUPER_ADMIN');
    const r = await renderArea('zone', '/zone/dashboard');
    expect(r.html).toContain('403');
    expect(r.html).toContain('access to this page');
    expect(r.html).not.toContain('page body');
    expect(r.html).not.toContain('aria-label="Main"');
  });

  it('Zonal Admin without zones goes to /zone/no-zones', async () => {
    session.me = me('ZONAL_ADMIN', 0);
    expect(await renderArea('zone', '/zone/dashboard')).toEqual({
      interrupt: 'redirect:/zone/no-zones',
    });
  });

  it('the right role gets the shell: skip link, main landmark, sidebar, user menu, page', async () => {
    session.me = me('SUPER_ADMIN');
    const r = await renderArea('super-admin', '/super-admin/dashboard');
    expect(r.html).toContain('href="#main"');
    expect(r.html).toContain('id="main"');
    expect(r.html).toContain('aria-label="Main"');
    expect(r.html).toContain('Asha Rao');
    expect(r.html).toContain('Super Admin');
    expect(r.html).toContain('page body');
    expect(r.html).toContain('switcher:SUPER_ADMIN:0'); // a Super Admin's switcher loads every zone itself
    session.me = me('ZONAL_ADMIN', 2);
    const z = await renderArea('zone', '/zone/dashboard');
    expect(z.html).toContain('switcher:ZONAL_ADMIN:2'); // the zone switcher (M05) with the member's own zones
    expect(z.html).not.toContain('Zone Management');
  });
});

describe('sidebar', () => {
  it('Coming Soon items carry the Soon tag and an accessible label; groups fold; the active item is marked', () => {
    const items = menuFor('SUPER_ADMIN', []);
    const html = renderToStaticMarkup(
      <Sidebar items={items} userRole="SUPER_ADMIN" activePath="/super-admin/settings/logs" />,
    );
    const soon = items.filter((i) => i.status === 'coming-soon').length;
    expect(html).toContain('aria-label="Payouts &amp; Reconciliation (coming soon)"');
    expect(html).toContain('href="/coming-soon/payouts"');
    expect(html.match(/data-status="coming-soon"/g)).toHaveLength(soon);
    expect(html.match(/>Soon</g)).toHaveLength(soon);
    expect(html).toContain('Requests &amp; Approvals');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('/brand/zoauro-logo.jpeg');
    expect(html).toMatch(
      /aria-current="page"[^>]*>(<span>)?Audit &amp; Logs|href="\/super-admin\/settings\/logs" aria-current="page"/,
    );
    expect(html).toContain('bg-sidebar-active');
  });

  it('a Zonal Admin’s active item is orange', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        items={menuFor('ZONAL_ADMIN', [])}
        userRole="ZONAL_ADMIN"
        activePath="/zone/dashboard"
      />,
    );
    expect(html).toContain('bg-accent-orange');
  });

  it('A9: an entry with work waiting shows its count (and says it to screen readers); none shows nothing', () => {
    const items = menuFor('SUPER_ADMIN', []);
    const html = renderToStaticMarkup(
      <Sidebar
        items={items}
        userRole="SUPER_ADMIN"
        activePath="/super-admin/dashboard"
        counts={{ R13: 3, R12: 120, R09: 0 }}
      />,
    );
    expect(html).toContain('aria-label="Access Requests, 3 waiting"');
    expect(html).toContain('>99+<');
    expect(html).not.toContain('Food Item Requests, 0 waiting');
  });
});

describe('header', () => {
  it('sign out posts to /auth/logout with the session CSRF token', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await signOut('csrf-token', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'csrf-token' },
    });
  });

  it('zone chip label', () => {
    const z = (name: string) => ({
      zoneId: name,
      name,
      code: 'X',
      colorHex: '#000000',
      status: 'ACTIVE' as const,
    });
    expect(zoneChipLabel([])).toBe('No zones');
    expect(zoneChipLabel([z('Chennai')])).toBe('Chennai');
    expect(zoneChipLabel([z('Chennai'), z('Madurai')])).toBe('2 zones');
  });
});
