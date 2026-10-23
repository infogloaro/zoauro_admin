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

  it('live: Dashboard, Recent Activities, Zones, Zone Teams, Control Panel, Super Admins, Zonal Admins, Access Profiles, Access History, Platform Settings, Settings History, Security Settings, Audit & Logs, Access Requests, Restaurants, Home Food, Orders, Delivery Partners, Partner Requests, Notifications, Menu Items, Food Item Requests, Hotels & Bookings, Vendor Plans, Customers, Support Tickets, Global Search, Payments, Refunds, COD Cash Settlement, Payouts, Vendor Onboarding, Order overview and Account security', () => {
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
      'M03-SA',
      'M03-TEAM',
      'M04',
      'M04-ACT',
      'M06',
      'M07',
      'M08',
      'M09',
      'M10',
      'M11',
      'M11-OV',
      'M12',
      'M13',
      'M14',
      'M15',
      'M16',
      'M17',
      'M18',
      'M19',
      'M19-HIST',
      'M19-SEC',
      'M20-SUP',
      'NEW-ADS',
      'NEW-HOTEL',
      'NEW-PLANS',
      'R01',
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
    // every module but Global Search, which has no sidebar entry (menu: false)
    expect(menu).toHaveLength(NAV_MODULES.filter((m) => m.menu !== false).length);
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
    expect(byId['NEW-PLANS']).toMatchObject({
      status: 'live',
      label: 'Vendor Plans',
      href: '/super-admin/vendor-plans',
    });
  });

  it('Vendor Plans (D188): a Zonal Admin sees it only with plans:view in some zone', () => {
    expect(menuFor('ZONAL_ADMIN', [zone('A', ['orders:view'])]).map((m) => m.id)).not.toContain(
      'NEW-PLANS',
    );
    expect(
      menuFor('ZONAL_ADMIN', [zone('A', ['orders:view']), zone('B', ['plans:view'])]).find(
        (m) => m.id === 'NEW-PLANS',
      ),
    ).toMatchObject({ status: 'live', href: '/zone/vendor-plans' });
  });

  it('Advertising (D201): live for Super Admins; a Zonal Admin sees it only with ads:view in some zone', () => {
    expect(menuFor('SUPER_ADMIN', []).find((m) => m.id === 'NEW-ADS')).toMatchObject({
      status: 'live',
      href: '/super-admin/ads',
    });
    expect(menuFor('ZONAL_ADMIN', [zone('A', ['orders:view'])]).map((m) => m.id)).not.toContain(
      'NEW-ADS',
    );
    expect(
      menuFor('ZONAL_ADMIN', [zone('A', ['ads:view'])]).find((m) => m.id === 'NEW-ADS'),
    ).toMatchObject({ status: 'live', href: '/zone/ads' });
  });

  it('Zonal Admin: never Zones, Audit, Access, Settings, Integrations, nor Hotels without a hotels grant; modules only where viewable in some zone', () => {
    const zones = [
      zone('A', ['orders:view', 'orders:edit', 'restaurants:view']),
      zone('BB', ['customers:view', 'payments:view']),
    ];
    expect(menuFor('ZONAL_ADMIN', zones).map((m) => m.label)).toEqual([
      'Dashboard',
      'Vendor Onboarding',
      'Access Requests',
      'Restaurants',
      'Orders',
      'Order overview',
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
      'NEW-PLANS',
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
      'M11-OV',
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

  it('pages that gather modules open with any one of them: Vendor Onboarding (restaurants, Home Food, hotels) and Hotels (hotels, room or table bookings)', () => {
    const ids = (perms: PermissionKey[]) =>
      menuFor('ZONAL_ADMIN', [zone('A', perms)]).map((m) => m.id);
    expect(ids(['homemakers:view'])).toContain('R01');
    expect(ids(['hotels:view'])).toContain('R01');
    expect(ids(['orders:view'])).not.toContain('R01');
    expect(ids(['bookings:view'])).toContain('NEW-HOTEL');
    expect(ids(['dining:view'])).toContain('NEW-HOTEL');
    expect(ids(['restaurants:view'])).not.toContain('NEW-HOTEL');
  });

  it('COD settlement and payouts (6a5f9b9) are live pages, each behind its own view grant', () => {
    const items = menuFor('ZONAL_ADMIN', [zone('A', ['settlements:view', 'payouts:view'])]);
    expect(items.find((m) => m.id === 'M14')).toMatchObject({
      status: 'live',
      href: '/zone/cod-settlement',
    });
    expect(items.find((m) => m.id === 'M15')).toMatchObject({
      status: 'live',
      href: '/zone/payouts',
    });
    expect(
      menuFor('ZONAL_ADMIN', [zone('A', ['settlements:view'])]).map((m) => m.id),
    ).not.toContain('M15');
  });

  it('a Coming Soon page exists only for a module this person could see', () => {
    const zones = [zone('A', ['orders:view'])];
    expect(comingSoonModule('orders', 'ZONAL_ADMIN', zones)).toBeNull(); // live
    expect(
      comingSoonModule('cod-settlement', 'ZONAL_ADMIN', [zone('A', ['settlements:view'])]),
    ).toBeNull(); // live since 6a5f9b9
    expect(
      comingSoonModule('restaurant-requests', 'ZONAL_ADMIN', [zone('A', ['restaurants:view'])]),
    ).toBeNull(); // live as Vendor Onboarding (D170)
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

  it('Audit & Logs gathers every history; Global Search has no sidebar entry (owner, 2026-10-22)', () => {
    const sa = groupedMenu(menuFor('SUPER_ADMIN', []));
    expect(sa.find((g) => g.id === 'audit')?.items.map((i) => i.label)).toEqual([
      'Audit & Logs',
      'Recent Activities',
      'Access History',
      'Settings History',
    ]);
    expect(sa.find((g) => g.id === 'audit')?.label).toBe('Audit & Logs');
    expect(menuFor('SUPER_ADMIN', []).map((i) => i.id)).not.toContain('M18');
    // the areas still decide: a non-primary with none of audit, access or settings gets no group at all
    const meena = groupedMenu(menuFor('SUPER_ADMIN', [], { isPrimary: false, areas: ['zones'] }));
    expect(meena.map((g) => g.id)).not.toContain('audit');
    const auditOnly = groupedMenu(
      menuFor('SUPER_ADMIN', [], { isPrimary: false, areas: ['audit'] }),
    );
    expect(auditOnly.find((g) => g.id === 'audit')?.items.map((i) => i.id)).toEqual([
      'M04',
      'M04-ACT',
    ]);
    const zonal = groupedMenu(menuFor('ZONAL_ADMIN', [zone('A', ['orders:view', 'audit:view'])]));
    expect(zonal.map((g) => g.id)).not.toContain('audit');
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

describe('D178 Control Panel areas', () => {
  const ids = (areas: { isPrimary: boolean; areas: string[] } | null) =>
    menuFor('SUPER_ADMIN', [], areas).map((m) => m.id);

  it('a primary (or no data) sees every entry', () => {
    expect(ids({ isPrimary: true, areas: [] })).toEqual(ids(null));
    expect(ids(null)).toEqual(expect.arrayContaining(['M03', 'M03-ACC', 'M19', 'M04', 'CP']));
  });

  it('a non-primary sees only the areas granted; operations and Super Admins stay', () => {
    const meena = ids({
      isPrimary: false,
      areas: ['zones', 'settings.refunds', 'settings.onboarding', 'settings.loyalty'],
    });
    for (const hidden of [
      'M03',
      'M03-ACC',
      'M03-HIST',
      'M03-TEAM',
      'R13',
      'M04',
      'M04-ACT',
      'M19-SEC',
    ])
      expect(meena).not.toContain(hidden);
    for (const shown of ['CP', 'M19', 'M19-HIST', 'M03-SA', 'M11', 'M06', 'M02'])
      expect(meena).toContain(shown);
    expect(ids({ isPrimary: false, areas: [] })).not.toContain('M19');
  });
});
