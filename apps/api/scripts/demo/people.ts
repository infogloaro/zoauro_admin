import type { PrismaClient } from './db';
import { ensurePrimarySuperAdmin, grantAreas, prepareAccount, userIdByEmail } from './bootstrap';
import { DemoClient, type DemoAccount } from './client';

// Step 1: zones, services, access profiles, Super Admins (primary + delegated "Admin"), Zonal Admins and their zone teams.

export interface DemoZone {
  code: string;
  name: string;
  city: string;
  from: string;
  to: string;
  chargePaise: number;
  color: string;
  status: 'ACTIVE' | 'UPCOMING';
  services?: { RESTAURANTS?: boolean; HOME_FOOD?: boolean; HOTEL_BOOKING?: boolean };
  description: string;
}

export const ZONES: DemoZone[] = [
  {
    code: 'CBE',
    name: 'Coimbatore Central',
    city: 'Coimbatore',
    from: '641001',
    to: '641020',
    chargePaise: 3000,
    color: '#2563EB',
    status: 'ACTIVE',
    services: { RESTAURANTS: true, HOME_FOOD: true, HOTEL_BOOKING: true },
    description: 'RS Puram, Gandhipuram, Peelamedu and the city centre.',
  },
  {
    code: 'CBN',
    name: 'Coimbatore North',
    city: 'Coimbatore',
    from: '641021',
    to: '641035',
    chargePaise: 3500,
    color: '#16A34A',
    status: 'ACTIVE',
    services: { RESTAURANTS: true, HOME_FOOD: true, HOTEL_BOOKING: true },
    description: 'Saravanampatti, Thudiyalur and Kovilpalayam.',
  },
  {
    code: 'TUP',
    name: 'Tiruppur',
    city: 'Tiruppur',
    from: '641601',
    to: '641610',
    chargePaise: 4000,
    color: '#EA580C',
    status: 'ACTIVE',
    services: { HOTEL_BOOKING: false },
    description: 'Tiruppur town and the knitwear belt.',
  },
  {
    code: 'PLC',
    name: 'Pollachi',
    city: 'Pollachi',
    from: '642001',
    to: '642008',
    chargePaise: 4000,
    color: '#7C3AED',
    status: 'UPCOMING',
    description: 'Launching next quarter: apps show "coming soon".',
  },
];

export type AccountKey = 'primary' | 'admin' | 'karthik' | 'priya' | 'suresh';

export const ACCOUNTS: Record<AccountKey, Omit<DemoAccount, 'password' | 'totpSecret'>> = {
  primary: {
    key: 'primary',
    name: 'Arun Prakash',
    email: 'superadmin@zoauro.demo',
    role: 'SUPER_ADMIN',
  },
  admin: { key: 'admin', name: 'Meena Sundaram', email: 'admin@zoauro.demo', role: 'SUPER_ADMIN' },
  karthik: {
    key: 'karthik',
    name: 'Karthik Raj',
    email: 'karthik.zonal@zoauro.demo',
    role: 'ZONAL_ADMIN',
  },
  priya: {
    key: 'priya',
    name: 'Priya Venkatesh',
    email: 'priya.zonal@zoauro.demo',
    role: 'ZONAL_ADMIN',
  },
  suresh: {
    key: 'suresh',
    name: 'Suresh Kumar',
    email: 'suresh.zonal@zoauro.demo',
    role: 'ZONAL_ADMIN',
  },
};

/** D178: the delegated Super Admin runs all-zone operations but only these Control Panel areas. */
export const ADMIN_AREAS = ['zones', 'settings.refunds', 'settings.onboarding', 'settings.loyalty'];

/** D182 F1: the zone leads run offers in their zones (their own offers still need a Super Admin's approval). */
const OFFERS_LEAD = (['view', 'add', 'edit', 'status', 'export'] as const).map((action) => ({
  module: 'offers',
  action,
  effect: 'GRANT' as const,
}));

export interface PeopleResult {
  zoneId: Record<string, string>;
  profileId: Record<string, string>;
  userId: Record<AccountKey, string>;
  clients: Record<AccountKey, DemoClient>;
}

interface ZoneDto {
  id: string;
  code: string;
  status: string;
  version: number;
}

type Log = (m: string) => void;

export async function seedPeople(
  db: PrismaClient,
  accounts: Record<AccountKey, DemoAccount>,
  api: { base: string; origin: string },
  encryption: { current: string; previous?: string },
  log: Log,
): Promise<PeopleResult> {
  const userId = {} as Record<AccountKey, string>;
  const clients = {} as Record<AccountKey, DemoClient>;

  // the primary Super Admin, then everything else through the API as that person
  userId.primary = await ensurePrimarySuperAdmin(db, accounts.primary);
  await prepareAccount(db, userId.primary, accounts.primary, encryption);
  const sa = new DemoClient(api.base, api.origin, accounts.primary);
  await sa.login();
  clients.primary = sa;
  log(`signed in as ${accounts.primary.email} (primary Super Admin)`);

  // zones
  const zoneId: Record<string, string> = {};
  for (const z of ZONES) {
    const found = await db.zone.findFirst({
      where: { code: z.code, deletedAt: null },
      select: { id: true },
    });
    let dto: ZoneDto;
    if (found) {
      dto = await sa.get<ZoneDto>(`/zones/${found.id}`);
    } else {
      dto = await sa.post<ZoneDto>('/zones', {
        name: z.name,
        code: z.code,
        city: z.city,
        state: 'Tamil Nadu',
        pincodeFrom: z.from,
        pincodeTo: z.to,
        deliveryChargePaise: z.chargePaise,
        colorHex: z.color,
        description: z.description,
      });
      log(`zone ${z.code} ${z.name} created`);
    }
    if (z.status === 'ACTIVE' && dto.status !== 'ACTIVE') {
      dto = await sa.post<ZoneDto>(`/zones/${dto.id}/activate`, { version: dto.version });
      log(`zone ${z.code} activated`);
    }
    if (z.services) await sa.put(`/zones/${dto.id}/services`, { services: z.services });
    zoneId[z.code] = dto.id;
  }

  // access profiles: the five seed profiles plus one restricted desk profile for the demo
  const profiles = await db.accessProfile.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const profileId: Record<string, string> = Object.fromEntries(profiles.map((p) => [p.name, p.id]));
  if (!profileId['Menu Desk']) {
    const p = await sa.post<{ id: string }>('/access-profiles', {
      name: 'Menu Desk',
      description:
        'Menu and food item requests only: view orders, no refunds or vendor status changes.',
      defaults: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
      permissions: [
        { module: 'dashboard', actions: ['view'] },
        { module: 'orders', actions: ['view'] },
        { module: 'restaurants', actions: ['view'] },
        { module: 'homemakers', actions: ['view'] },
        { module: 'menu', actions: ['view', 'add', 'edit', 'status'] },
      ],
    });
    profileId['Menu Desk'] = p.id;
    log('access profile "Menu Desk" created');
  }

  // the delegated Super Admin ("Admin") and the Zonal Admins
  for (const key of ['admin', 'karthik', 'priya', 'suresh'] as const) {
    const a = accounts[key];
    let id = await userIdByEmail(db, a.email);
    if (!id) {
      const created =
        a.role === 'SUPER_ADMIN'
          ? await sa.post<{ id: string }>('/super-admins', {
              name: a.name,
              email: a.email,
              phone: '+919840012345',
              temporaryPassword: a.password,
              reason: 'Demo: delegated Super Admin for refunds, onboarding and reward points',
            })
          : await sa.post<{ id: string }>('/zonal-admins', {
              name: a.name,
              email: a.email,
              temporaryPassword: a.password,
            });
      id = created.id;
      log(`${a.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Zonal Admin'} ${a.email} created`);
    }
    userId[key] = id;
    await prepareAccount(db, id, a, encryption);
  }
  await grantAreas(db, userId.admin, userId.primary, ADMIN_AREAS);

  // zone teams: Karthik runs two zones (full in CBE, restricted in CBN); CBE has two Zonal Admins (Karthik, Priya)
  const limits = (perRefund: number, dailyRefund: number) => ({
    perRefund,
    dailyRefund,
    canReveal: null,
    canExport: null,
  });
  await sa.put(`/zonal-admins/${userId.karthik}/access`, {
    assignments: [
      {
        zoneId: zoneId['CBE'],
        profileId: profileId['Zone Manager'],
        // the profile has no support desk or notifications: granted to the zone lead here (doc 04 overrides)
        overrides: [
          { module: 'support', action: 'view', effect: 'GRANT' },
          { module: 'support', action: 'edit', effect: 'GRANT' },
          { module: 'notifications', action: 'view', effect: 'GRANT' },
          { module: 'notifications', action: 'add', effect: 'GRANT' },
          ...OFFERS_LEAD,
        ],
        limits: limits(50_000, 200_000),
        note: 'Zone lead for Coimbatore Central',
      },
      {
        zoneId: zoneId['CBN'],
        profileId: profileId['Operations'],
        overrides: [
          { module: 'menu', action: 'edit', effect: 'DENY' },
          { module: 'menu', action: 'delete', effect: 'DENY' },
          { module: 'refunds', action: 'edit', effect: 'DENY' },
        ],
        limits: limits(20_000, 50_000),
        note: 'Covers Coimbatore North: no menu edits, no refunds',
      },
    ],
  });
  await sa.put(`/zonal-admins/${userId.priya}/access`, {
    assignments: [
      {
        zoneId: zoneId['CBE'],
        profileId: profileId['Menu Desk'],
        note: 'Menu desk, Coimbatore Central',
      },
    ],
  });
  await sa.put(`/zonal-admins/${userId.suresh}/access`, {
    assignments: [
      {
        zoneId: zoneId['TUP'],
        profileId: profileId['Zone Manager'],
        overrides: OFFERS_LEAD,
        limits: limits(30_000, 100_000),
        note: 'Zone lead for Tiruppur',
      },
    ],
  });
  log('zone teams set (Karthik: CBE + CBN, Priya: CBE, Suresh: TUP)');

  for (const key of ['admin', 'karthik', 'priya', 'suresh'] as const) {
    const c = new DemoClient(api.base, api.origin, accounts[key]);
    await c.login();
    clients[key] = c;
  }

  // a pending access request for the Super Admin's inbox: Karthik asks for the menu editing his CBN override denies
  const pending = await db.accessRequest.count({
    where: { requesterId: userId.karthik, status: 'PENDING' },
  });
  if (pending === 0) {
    await clients.karthik.post('/me/access-requests', {
      kind: 'PERMISSION',
      zoneId: zoneId['CBN'],
      module: 'menu',
      action: 'edit',
      reason:
        'Vendors in Coimbatore North keep calling about price fixes; I can do them the same day.',
    });
    log('access request from Karthik (menu:edit in CBN) pending');
  }
  return { zoneId, profileId, userId, clients };
}
