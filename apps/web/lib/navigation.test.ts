import { describe, expect, it } from 'vitest';
import type { MeResponse, MeZone, PermissionKey } from '@zoauro/shared';
import {
  DOC39_MODULE_IDS,
  NAV_GROUPS,
  NAV_MODULES,
  activeItem,
  comingSoonModule,
  groupedMenu,
  homeFor,
  menuFor,
  visibleModules,
} from './navigation';
import { areaGate, loginUrl, safeNext } from './server-session';

// P14 (doc 56): the menu config of doc 39 / doc 18 plus the owner's roadmap additions, filtered by role and by /me,
// and the area guard.

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

describe('module catalogue (doc 39 + roadmap)', () => {
  it('keeps every doc 39 module (M01–M21 without M05) and the roadmap additions; ids and slugs are unique', () => {
    const ids = NAV_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(NAV_MODULES.map((m) => m.slug)).size).toBe(ids.length);
    expect(ids).not.toContain('M05');
    for (const id of DOC39_MODULE_IDS) expect(ids).toContain(id);
    for (const id of ['R01', 'R09', 'R11', 'R12', 'R13', 'NEW-HOTEL']) expect(ids).toContain(id);
  });

  it('live: Dashboard, Recent Activities, Zones, Zone Teams, Control Panel, Zonal Admins, Access Profiles, Access History, Platform Settings, Settings History, Security Settings, Audit & Logs, Access Requests, Restaurants, Home Food, Orders, Delivery Partners, Partner Requests, Notifications, Menu Items, Food Item Requests, Hotels & Bookings and Account security', () => {
    expect(
      NAV_MODULES.filter((m) => m.status === 'live')
        .map((m) => m.id)
        .sort(),
    ).toEqual([
      'CP',
      'M01',
      'M02',
      'M03',
      'M03-ACC',
      'M03-HIST',
      'M03-TEAM',
      'M04',
      'M04-ACT',
      'M06',
      'M07',
      'M08',
      'M10',
      'M11',
      'M16',
      'M17',
      'M19',
      'M19-HIST',
      'M19-SEC',
      'NEW-HOTEL',
      'R09',
      'R12',
      'R13',
    ]);
  });

  it('every module not built yet has a plan with at least one screen; every module sits in a known group', () => {
    const groups = new Set(NAV_GROUPS.map((g) => g.id));
    for (const m of NAV_MODULES) {
      expect(groups.has(m.group)).toBe(true);
      if (m.status === 'coming-soon') expect(m.blueprint?.screens.length ?? 0).toBeGreaterThan(0);
    }
    // Phase 2 work is never presented as Phase 1 (roadmap R22, AC-16)
    expect(NAV_MODULES.find((m) => m.id === 'M20-OFF')?.blueprint?.phase).toBe('Phase 2');
  });
});

describe('menu by role', () => {
  it('Super Admin: every module; live ones link to their page, the rest to /coming-soon/<slug>', () => {
    const menu = menuFor('SUPER_ADMIN', []);
    expect(menu).toHaveLength(NAV_MODULES.length);
    const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
    expect(byId['M16']).toMatchObject({ status: 'live', href: '/super-admin/dashboard' });
    expect(byId['M04-ACT']).toMatchObject({ status: 'live', href: '/super-admin/activity' });
    expect(byId['M02']).toMatchObject({ status: 'live', href: '/super-admin/zones' });
    expect(byId['M04']).toMatchObject({ status: 'live', href: '/super-admin/settings/logs' });
    expect(byId['M19-SEC']).toMatchObject({
      status: 'live',
      href: '/super-admin/settings/security',
    });
    expect(byId['M01']).toMatchObject({ status: 'live', href: '/account/security' });
    expect(byId['M11']).toMatchObject({ status: 'live', href: '/super-admin/orders' });
    expect(byId['M19']).toMatchObject({ status: 'live', href: '/super-admin/settings/platform' });
    expect(byId['M19-HIST']).toMatchObject({
      status: 'live',
      href: '/super-admin/settings/history',
    });
    expect(byId['NEW-HOTEL']).toMatchObject({
      status: 'live',
      label: 'Hotels & Bookings',
      href: '/super-admin/hotels',
    });
  });

  it('Zonal Admin: never Zones, Audit, Access, Settings, Integrations, nor Hotels without a hotels grant; modules only where viewable in some zone', () => {
    const zones = [
      zone('A', ['orders:view', 'orders:edit', 'restaurants:view']),
      zone('BB', ['customers:view', 'payments:view']),
    ];
    expect(menuFor('ZONAL_ADMIN', zones).map((m) => m.label)).toEqual([
      'Dashboard',
      'Restaurant Onboarding',
      'Access Requests',
      'Restaurants',
      'Orders',
      'Customers',
      'Payments',
      'Account security',
    ]);
    const ids = visibleModules('ZONAL_ADMIN', zones).map((m) => m.id);
    for (const hidden of [
      'M02',
      'M03',
      'M03-ACC',
      'M03-TEAM',
      'M03-HIST',
      'M04',
      'M04-ACT',
      'M19',
      'M19-HIST',
      'M19-SEC',
      'M21',
      'M08',
      'M13',
      'NEW-HOTEL',
      'R11',
    ])
      expect(ids).not.toContain(hidden);
    expect(menuFor('ZONAL_ADMIN', zones)[0]).toMatchObject({
      href: '/zone/dashboard',
      status: 'live',
    });
  });

  it('a module denied everywhere (payments:view removed) is not listed; no zone at all leaves Dashboard, Access Requests and Account security', () => {
    expect(menuFor('ZONAL_ADMIN', [zone('A', ['orders:view'])]).map((m) => m.id)).toEqual([
      'M16',
      'R13',
      'M11',
      'M01',
    ]);
    expect(menuFor('ZONAL_ADMIN', []).map((m) => m.id)).toEqual(['M16', 'R13', 'M01']);
  });

  it('owner decisions D36, D93, D94: refunds, COD settlement, support and notifications appear for a Zonal Admin granted them', () => {
    const granted = [
      zone('A', ['refunds:view', 'settlements:view', 'support:view', 'notifications:view']),
    ];
    const ids = menuFor('ZONAL_ADMIN', granted).map((m) => m.id);
    for (const id of ['M13', 'M14', 'M20-SUP', 'M17']) expect(ids).toContain(id);
    const none = menuFor('ZONAL_ADMIN', [zone('A', ['orders:view'])]).map((m) => m.id);
    for (const id of ['M13', 'M14', 'M20-SUP', 'M17']) expect(none).not.toContain(id);
  });

  it('a Coming Soon page exists only for a module this person could see', () => {
    const zones = [zone('A', ['orders:view'])];
    expect(comingSoonModule('orders', 'ZONAL_ADMIN', zones)).toBeNull(); // live
    expect(
      comingSoonModule('restaurant-requests', 'ZONAL_ADMIN', [zone('A', ['restaurants:view'])])?.id,
    ).toBe('R01');
    expect(comingSoonModule('access-requests', 'ZONAL_ADMIN', zones)).toBeNull(); // live
    expect(comingSoonModule('settings', 'ZONAL_ADMIN', zones)).toBeNull();
    expect(comingSoonModule('customers', 'ZONAL_ADMIN', zones)).toBeNull();
    expect(comingSoonModule('hotel-booking', 'ZONAL_ADMIN', zones)).toBeNull();
    expect(comingSoonModule('integrations', 'SUPER_ADMIN', [])?.id).toBe('M21');
    expect(comingSoonModule('settings', 'SUPER_ADMIN', [])).toBeNull(); // live since doc 59
    expect(comingSoonModule('zones', 'SUPER_ADMIN', [])).toBeNull(); // live, not "coming soon"
    expect(comingSoonModule('security-settings', 'SUPER_ADMIN', [])).toBeNull();
    expect(comingSoonModule('nope', 'SUPER_ADMIN', [])).toBeNull();
  });

  it('groups follow the sidebar order and leave out empty groups', () => {
    const sa = groupedMenu(menuFor('SUPER_ADMIN', []));
    expect(sa.map((g) => g.id)).toEqual(NAV_GROUPS.map((g) => g.id));
    const zonal = groupedMenu(menuFor('ZONAL_ADMIN', []));
    expect(zonal.map((g) => g.id)).toEqual(['overview', 'requests', 'account']);
  });

  it('the active entry is the longest matching link', () => {
    const menu = menuFor('SUPER_ADMIN', []);
    expect(activeItem(menu, '/super-admin/settings/security')?.id).toBe('M19-SEC');
    expect(activeItem(menu, '/super-admin/zones/0192f1d2-0000-7000-8000-000000000001')?.id).toBe(
      'M02',
    );
    expect(activeItem(menu, '/somewhere/else')).toBeNull();
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
