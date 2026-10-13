import { describe, expect, it } from 'vitest';
import type { MeResponse, MeZone, PermissionKey } from '@zoauro/shared';
import { NAV_MODULES, comingSoonModule, homeFor, menuFor, visibleModules } from './navigation';
import { areaGate, loginUrl, safeNext } from './server-session';

// P14 (doc 56): the menu config of doc 39 / doc 18, filtered by role and by /me, and the area guard.

const zone = (code: string, permissions: PermissionKey[]): MeZone => ({
  zoneId: `0192f1d2-0000-7000-8000-00000000000${code.length}`,
  name: `Zone ${code}`,
  code,
  colorHex: '#2563EB',
  status: 'ACTIVE',
  permissions,
  limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
});

const me = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN', zones: MeZone[] = []): MeResponse => ({
  user: { id: '0192f1d2-0000-7000-8000-0000000000aa', name: 'Test', email: 't@example.test', role },
  mustChangePassword: false,
  csrfToken: 'csrf',
  permissions: role === 'SUPER_ADMIN' ? { global: true } : { global: false, zones },
  mfa: { enabled: true, required: true, enrolmentNeeded: false },
});

describe('module catalogue (doc 39)', () => {
  it('has the 20 modules M01–M21 without M05 (the zone scope switcher), unique ids and slugs', () => {
    const ids = NAV_MODULES.map((m) => m.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids).not.toContain('M05');
    expect(
      Array.from({ length: 21 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`).filter(
        (id) => id !== 'M05' && !ids.includes(id),
      ),
    ).toEqual([]);
    expect(new Set(NAV_MODULES.map((m) => m.slug)).size).toBe(20);
  });

  it('only Dashboard, Zones, Audit & Logs and Account security are live', () => {
    expect(
      NAV_MODULES.filter((m) => m.status === 'live')
        .map((m) => m.id)
        .sort(),
    ).toEqual(['M01', 'M02', 'M04', 'M16']);
  });
});

describe('menu by role', () => {
  it('Super Admin: every module; live ones link to their page, the rest to /coming-soon/<slug>', () => {
    const menu = menuFor('SUPER_ADMIN', []);
    expect(menu).toHaveLength(20);
    const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
    expect(byId['M16']).toMatchObject({ status: 'live', href: '/super-admin/dashboard' });
    expect(byId['M02']).toMatchObject({ status: 'live', href: '/super-admin/zones' });
    expect(byId['M04']).toMatchObject({ status: 'live', href: '/super-admin/settings/logs' });
    expect(byId['M01']).toMatchObject({ status: 'live', href: '/account/security' });
    expect(byId['M11']).toMatchObject({ status: 'coming-soon', href: '/coming-soon/orders' });
    expect(byId['M19']).toMatchObject({ status: 'coming-soon', href: '/coming-soon/settings' });
  });

  it('Zonal Admin: never Zones, Audit, Access, Settings or Integrations; modules only where viewable in some zone', () => {
    const zones = [
      zone('A', ['orders:view', 'orders:edit', 'restaurants:view']),
      zone('BB', ['customers:view', 'payments:view']),
    ];
    expect(menuFor('ZONAL_ADMIN', zones).map((m) => m.label)).toEqual([
      'Dashboard',
      'Orders',
      'Restaurants',
      'Customers',
      'Payments',
      'Account security',
    ]);
    const ids = visibleModules('ZONAL_ADMIN', zones).map((m) => m.id);
    for (const hidden of ['M02', 'M03', 'M04', 'M19', 'M21', 'M08', 'M13'])
      expect(ids).not.toContain(hidden);
    expect(menuFor('ZONAL_ADMIN', zones)[0]).toMatchObject({
      href: '/zone/dashboard',
      status: 'live',
    });
  });

  it('a module denied everywhere (payments:view removed) is not listed; no zone at all leaves Dashboard and Account security', () => {
    expect(menuFor('ZONAL_ADMIN', [zone('A', ['orders:view'])]).map((m) => m.id)).toEqual([
      'M16',
      'M11',
      'M01',
    ]);
    expect(menuFor('ZONAL_ADMIN', []).map((m) => m.id)).toEqual(['M16', 'M01']);
  });

  it('a Coming Soon page exists only for a module this person could see', () => {
    const zones = [zone('A', ['orders:view'])];
    expect(comingSoonModule('orders', 'ZONAL_ADMIN', zones)?.id).toBe('M11');
    expect(comingSoonModule('settings', 'ZONAL_ADMIN', zones)).toBeNull();
    expect(comingSoonModule('customers', 'ZONAL_ADMIN', zones)).toBeNull();
    expect(comingSoonModule('settings', 'SUPER_ADMIN', [])?.id).toBe('M19');
    expect(comingSoonModule('zones', 'SUPER_ADMIN', [])).toBeNull(); // live, not "coming soon"
    expect(comingSoonModule('nope', 'SUPER_ADMIN', [])).toBeNull();
  });

  it('role routing (doc 18 section 1)', () => {
    expect(homeFor('SUPER_ADMIN', [])).toBe('/super-admin/dashboard');
    expect(homeFor('ZONAL_ADMIN', [zone('A', [])])).toBe('/zone/dashboard');
    expect(homeFor('ZONAL_ADMIN', [])).toBe('/zone/no-zones');
  });
});

describe('protected areas (owner decision P14: 404 for /super-admin, 403 for /zone)', () => {
  it('signed out: /login?next=<this path>', () => {
    expect(areaGate('super-admin', null, '/super-admin/zones')).toEqual({
      kind: 'login',
      to: '/login?next=%2Fsuper-admin%2Fzones',
    });
    expect(areaGate('zone', null, '/zone/dashboard')).toEqual({
      kind: 'login',
      to: '/login?next=%2Fzone%2Fdashboard',
    });
    expect(areaGate('shared', null, '/coming-soon/orders').kind).toBe('login');
  });

  it('wrong role: Zonal Admin on /super-admin is 404, Super Admin on /zone is 403', () => {
    expect(
      areaGate('super-admin', me('ZONAL_ADMIN', [zone('A', [])]), '/super-admin/dashboard'),
    ).toEqual({
      kind: 'not-found',
    });
    expect(areaGate('zone', me('SUPER_ADMIN'), '/zone/dashboard')).toEqual({ kind: 'forbidden' });
  });

  it('a Zonal Admin with no zone goes to /zone/no-zones; the right role passes with its zones', () => {
    expect(areaGate('zone', me('ZONAL_ADMIN'), '/zone/dashboard')).toEqual({
      kind: 'redirect',
      to: '/zone/no-zones',
    });
    expect(areaGate('zone', me('ZONAL_ADMIN'), '/zone/no-zones').kind).toBe('ok');
    const z = [zone('A', ['orders:view'])];
    expect(areaGate('zone', me('ZONAL_ADMIN', z), '/zone/dashboard')).toMatchObject({
      kind: 'ok',
      role: 'ZONAL_ADMIN',
      zones: z,
    });
    expect(areaGate('super-admin', me('SUPER_ADMIN'), '/super-admin/zones')).toMatchObject({
      kind: 'ok',
      zones: [],
    });
    expect(areaGate('shared', me('ZONAL_ADMIN', z), '/account/security').kind).toBe('ok');
  });

  it('a pending first-login password change sends every area to /change-password (P15)', () => {
    const restricted = { ...me('SUPER_ADMIN'), mustChangePassword: true };
    for (const area of ['super-admin', 'zone', 'shared'] as const)
      expect(areaGate(area, restricted, '/account/security')).toEqual({
        kind: 'redirect',
        to: '/change-password',
      });
  });

  it('?next= only ever names one of our own areas (no open redirect)', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/login',
      '/zone/../login',
      '/super-admin\\evil',
      '',
    ])
      expect(safeNext(bad)).toBeNull();
    expect(safeNext('/super-admin/settings/logs')).toBe('/super-admin/settings/logs');
    expect(loginUrl('//evil.example')).toBe('/login');
  });
});
