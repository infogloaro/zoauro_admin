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
    expect(r.html).not.toContain('show my zones'); // the zone chip is for Zonal Admins
    session.me = me('ZONAL_ADMIN', 2);
    const z = await renderArea('zone', '/zone/dashboard');
    expect(z.html).toContain('2 zones');
    expect(z.html).not.toContain('Zone Management');
  });
});

describe('sidebar', () => {
  it('Coming Soon items carry the badge and an accessible label; the active item is marked', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        items={menuFor('SUPER_ADMIN', [])}
        userRole="SUPER_ADMIN"
        activePath="/super-admin/settings/logs"
      />,
    );
    expect(html).toContain('aria-label="Orders (coming soon)"');
    expect(html).toContain('href="/coming-soon/orders"');
    expect(html.match(/Coming Soon/g)).toHaveLength(16);
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
