import type { DemoClient } from './client';
import { DemoHttpError } from './client';
import type { SeededCustomer } from './customers';
import type { PrismaClient } from './db';
import type { SeededVendor } from './vendors';

// Steps: hotels with room and table bookings (D118, D127), support tickets in every status (D139-D141), and
// notifications (a message sent, a promotion waiting for approval, one approved and scheduled; D134-D137).

type Log = (m: string) => void;

const day = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function tryStep(log: Log, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    log(
      `${what} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''} ${JSON.stringify(e.body).slice(0, 200)}` : e instanceof Error ? e.message : 'error'}`,
    );
  }
}

// ---- hotels -------------------------------------------------------------------------------------------------------

const HOTELS = [
  {
    zone: 'CBE',
    name: 'The Residency Towers',
    owner: 'Arvind Krishnan',
    area: 'Avinashi Road',
    address: '1076 Avinashi Road, Coimbatore 641018',
    rooms: 120,
    commissionPct: 10,
    stage: 'LIVE',
  },
  {
    zone: 'CBE',
    name: 'Hotel Annapoorna Residency',
    owner: 'K. Ramasamy',
    area: 'RS Puram',
    address: '75 East Periasamy Road, RS Puram, Coimbatore 641002',
    rooms: 48,
    commissionPct: 12,
    stage: 'LIVE',
  },
  {
    zone: 'CBN',
    name: 'Kovai Grand Inn',
    owner: 'S. Prabhu',
    area: 'Saravanampatti',
    address: '14 Sathy Road, Saravanampatti, Coimbatore 641035',
    rooms: 36,
    stage: 'REVIEW',
  },
  {
    zone: 'CBE',
    name: 'Lotus Comforts',
    owner: 'R. Jagan',
    area: 'Gandhipuram',
    address: '9 100 Feet Road, Gandhipuram, Coimbatore 641012',
    rooms: 22,
    stage: 'REJECTED',
  },
] as const;

interface Versioned {
  id: string;
  version: number;
}

export async function seedHotels(
  db: PrismaClient,
  sa: DemoClient,
  zoneId: Record<string, string>,
  customers: SeededCustomer[],
  vendors: SeededVendor[],
  log: Log,
): Promise<void> {
  const ids: string[] = [];
  for (const [i, h] of HOTELS.entries()) {
    const found = await db.hotel.findFirst({
      where: { name: h.name, deletedAt: null },
      select: { id: true },
    });
    if (found) {
      if (h.stage === 'LIVE') ids.push(found.id);
      continue;
    }
    let id = '';
    await tryStep(log, `hotel ${h.name}`, async () => {
      const r = await sa.post<{ id: string }>('/hotels', {
        zoneId: zoneId[h.zone],
        name: h.name,
        ownerName: h.owner,
        phone: `+9194${String(4200 + i).padStart(4, '0')}${String(7000 + i * 13).slice(-4)}`,
        email: `${h.name
          .toLowerCase()
          .replace(/[^a-z]+/g, '.')
          .replace(/^\.|\.$/g, '')}@hotels.zoauro.demo`,
        address: h.address,
        area: h.area,
        totalRooms: h.rooms,
        ...('commissionPct' in h ? { commissionPct: h.commissionPct } : {}),
        gstNo: `33AAHC${String(5000 + i)}K1Z${i}`,
      });
      id = r.id;
      if (h.stage === 'LIVE') {
        await sa.post(`/hotels/${id}/verification`, { decision: 'VERIFIED' });
        await sa.post(`/hotels/${id}/status`, { status: 'ACTIVE' });
      }
      if (h.stage === 'REJECTED')
        await sa.post(`/hotels/${id}/verification`, {
          decision: 'REJECTED',
          note: 'Fire safety certificate missing; re-apply with it.',
        });
      log(`hotel ${h.name} (${h.zone}): ${h.stage}`);
    });
    if (id && h.stage === 'LIVE') ids.push(id);
  }
  if ((await db.roomBooking.count()) > 0 || ids.length === 0) return;

  // room bookings across their statuses
  const guests = customers.filter((c) => !c.blocked);
  const bookings: {
    hotel: string;
    c: SeededCustomer;
    room: string;
    in: number;
    out: number;
    amount: number;
    to: string[];
  }[] = [
    {
      hotel: ids[0] ?? '',
      c: guests[0] as SeededCustomer,
      room: 'Deluxe King',
      in: 3,
      out: 5,
      amount: 1_100_000,
      to: ['CONFIRMED'],
    },
    {
      hotel: ids[0] ?? '',
      c: guests[2] as SeededCustomer,
      room: 'Executive Suite',
      in: 0,
      out: 2,
      amount: 1_800_000,
      to: ['CONFIRMED', 'CHECKED_IN'],
    },
    {
      hotel: ids[0] ?? '',
      c: guests[4] as SeededCustomer,
      room: 'Deluxe Twin',
      in: -3,
      out: -1,
      amount: 900_000,
      to: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
    },
    {
      hotel: ids[1] ?? ids[0] ?? '',
      c: guests[6] as SeededCustomer,
      room: 'Standard Double',
      in: 1,
      out: 2,
      amount: 350_000,
      to: [],
    },
    {
      hotel: ids[1] ?? ids[0] ?? '',
      c: guests[8] as SeededCustomer,
      room: 'Family Room',
      in: 7,
      out: 9,
      amount: 700_000,
      to: ['CANCELLED'],
    },
  ];
  for (const b of bookings) {
    await tryStep(log, 'room booking', async () => {
      let r = await sa.post<Versioned>(`/hotels/${b.hotel}/bookings`, {
        customerName: b.c.name,
        customerPhone: b.c.phone,
        roomType: b.room,
        checkIn: day(b.in),
        checkOut: day(b.out),
        guests: 2,
        amount: b.amount,
        paymentStatus: b.to.includes('CANCELLED') ? 'REFUNDED' : b.to.length ? 'PAID' : 'PENDING',
      });
      for (const s of b.to) {
        r = await sa.post<Versioned>(`/hotels/bookings/${r.id}/status`, {
          status: s,
          version: r.version,
          ...(s === 'CANCELLED' ? { note: 'Guest changed travel plans.' } : {}),
        });
      }
    });
  }
  // table bookings at a hotel and at a restaurant
  const anna = vendors.find((v) => v.name === 'Annapoorna Gowrishankar');
  const tables: {
    where: Record<string, string>;
    c: SeededCustomer;
    date: number;
    time: string;
    guests: number;
    to: string[];
  }[] = [
    {
      where: { hotelId: ids[0] ?? '' },
      c: guests[1] as SeededCustomer,
      date: 0,
      time: '20:00',
      guests: 4,
      to: ['CONFIRMED'],
    },
    {
      where: { hotelId: ids[0] ?? '' },
      c: guests[3] as SeededCustomer,
      date: -1,
      time: '13:00',
      guests: 6,
      to: ['CONFIRMED', 'COMPLETED'],
    },
    ...(anna
      ? [
          {
            where: { restaurantId: anna.id },
            c: guests[5] as SeededCustomer,
            date: 1,
            time: '19:30',
            guests: 2,
            to: [],
          },
        ]
      : []),
    {
      where: { hotelId: ids[1] ?? ids[0] ?? '' },
      c: guests[7] as SeededCustomer,
      date: -2,
      time: '21:00',
      guests: 3,
      to: ['CONFIRMED', 'NO_SHOW'],
    },
    {
      where: { hotelId: ids[1] ?? ids[0] ?? '' },
      c: guests[9] as SeededCustomer,
      date: 2,
      time: '12:30',
      guests: 8,
      to: ['CANCELLED'],
    },
  ];
  for (const t of tables) {
    await tryStep(log, 'table booking', async () => {
      let r = await sa.post<Versioned>('/hotels/dining', {
        ...t.where,
        customerName: t.c.name,
        customerPhone: t.c.phone,
        reservedDate: day(t.date),
        reservedTime: t.time,
        guests: t.guests,
        tableArea: t.guests > 5 ? 'Private dining' : 'Main hall',
      });
      for (const s of t.to)
        r = await sa.post<Versioned>(`/hotels/dining/${r.id}/status`, {
          status: s,
          version: r.version,
        });
    });
  }
  log(`room bookings: ${bookings.length}, table bookings: ${tables.length}`);
}

// ---- support desk -------------------------------------------------------------------------------------------------

interface TicketRef {
  id: string;
  version: number;
}

export async function seedSupport(
  db: PrismaClient,
  sa: DemoClient,
  zonal: DemoClient,
  customers: SeededCustomer[],
  assignees: { superAdmin: string; zonal: string },
  log: Log,
): Promise<void> {
  const cust = customers.filter((c) => !c.blocked);
  const orderOf = async (customerId: string) =>
    (await db.order.findFirst({ where: { customerId, status: 'DELIVERED' }, select: { id: true } }))
      ?.id;
  const tickets: {
    c: SeededCustomer;
    category: 'ORDER' | 'PAYMENT_REFUND' | 'DELIVERY' | 'ACCOUNT' | 'OTHER';
    priority: 'LOW' | 'NORMAL' | 'HIGH';
    subject: string;
    description: string;
    path: ('ASSIGNED' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED' | 'REOPENED')[];
    by: 'sa' | 'zonal';
  }[] = [
    {
      c: cust[0] as SeededCustomer,
      category: 'ORDER',
      priority: 'HIGH',
      subject: 'Biryani arrived cold',
      description: 'Ordered at 1 pm, came at 2:10 and was cold. Please check.',
      path: [],
      by: 'sa',
    },
    {
      c: cust[1] as SeededCustomer,
      category: 'PAYMENT_REFUND',
      priority: 'NORMAL',
      subject: 'Charged twice for one order',
      description: 'My UPI shows two debits of the same amount.',
      path: ['ASSIGNED'],
      by: 'zonal',
    },
    {
      c: cust[2] as SeededCustomer,
      category: 'DELIVERY',
      priority: 'NORMAL',
      subject: 'Partner could not find my flat',
      description: 'Please ask partners to call when they reach the gate.',
      path: ['ASSIGNED', 'WAITING_CUSTOMER'],
      by: 'zonal',
    },
    {
      c: cust[3] as SeededCustomer,
      category: 'ORDER',
      priority: 'LOW',
      subject: 'Missing chutney',
      description: 'The dosa came without chutney.',
      path: ['ASSIGNED', 'RESOLVED'],
      by: 'zonal',
    },
    {
      c: cust[4] as SeededCustomer,
      category: 'ACCOUNT',
      priority: 'LOW',
      subject: 'Change my phone number',
      description: 'I have a new number and want to keep my reward points.',
      path: ['ASSIGNED', 'RESOLVED', 'CLOSED'],
      by: 'sa',
    },
    {
      c: cust[5] as SeededCustomer,
      category: 'PAYMENT_REFUND',
      priority: 'HIGH',
      subject: 'Refund not received',
      description: 'Cancelled order refund promised in 3 days, still not credited.',
      path: ['ASSIGNED', 'RESOLVED', 'REOPENED'],
      by: 'sa',
    },
  ];
  let made = 0;
  for (const t of tickets) {
    const existing = await db.supportTicket.findFirst({
      where: { subject: t.subject, customerId: t.c.id },
      select: { id: true, version: true, status: true },
    });
    // a ticket past version 1 was worked by an earlier run
    if (existing && existing.version > 1) continue; // version 1: created (auto-assigned) but not worked yet
    await tryStep(log, `ticket "${t.subject}"`, async () => {
      let ref: TicketRef;
      if (existing) {
        ref = { id: existing.id, version: existing.version };
      } else {
        const orderId = await orderOf(t.c.id);
        const body = {
          customerId: t.c.id,
          ...(orderId ? { orderId } : {}),
          zoneId: t.c.zoneId,
          category: t.category,
          priority: t.priority,
          subject: t.subject,
          description: t.description,
        };
        // creation picks an assignee round-robin; under load it has failed once, so it is retried once
        ref = await sa
          .post<TicketRef>('/support/tickets', body)
          .catch(() => sa.post<TicketRef>('/support/tickets', body));
      }
      const actor = t.by === 'zonal' ? zonal : sa;
      const versioned = async (c: DemoClient, path: string, body: unknown) => {
        const r = await c.postVersioned<TicketRef>(path, ref.version, body);
        ref = { id: ref.id, version: r.version };
      };
      for (const step of t.path) {
        if (step === 'ASSIGNED') {
          await versioned(sa, `/support/tickets/${ref.id}/assign`, {
            assigneeId: t.by === 'zonal' ? assignees.zonal : assignees.superAdmin,
          });
          await actor.post(`/support/tickets/${ref.id}/messages`, {
            visibility: 'PUBLIC',
            body: `Hello ${t.c.name.split(' ')[0]}, sorry about this. We are looking into it now.`,
          });
          await actor.post(`/support/tickets/${ref.id}/messages`, {
            visibility: 'INTERNAL',
            body: 'Checked the order timeline; raising it with the vendor.',
          });
          ref.version = (await sa.get<TicketRef>(`/support/tickets/${ref.id}`)).version;
          continue;
        }
        await versioned(actor, `/support/tickets/${ref.id}/transition`, {
          to: step,
          ...(step === 'RESOLVED' ? { note: 'Resolved with the vendor; customer informed.' } : {}),
          ...(step === 'REOPENED'
            ? { note: 'Customer says the money has still not arrived.' }
            : {}),
        });
      }
      made += 1;
    });
  }
  log(`support tickets: ${made} seeded (new, assigned, waiting, resolved, closed, reopened)`);
}

// ---- notifications ------------------------------------------------------------------------------------------------

export async function seedNotifications(
  db: PrismaClient,
  sa: DemoClient,
  delegated: DemoClient,
  zoneId: Record<string, string>,
  log: Log,
): Promise<void> {
  const has = async (title: string) => (await db.notification.count({ where: { title } })) > 0;
  if (!(await has('Heavy rain: deliveries may be late')))
    await tryStep(log, 'message to customers', () =>
      sa.post('/notifications', {
        kind: 'MESSAGE',
        audience: 'CUSTOMERS',
        zoneIds: [zoneId['CBE'], zoneId['CBN']],
        title: 'Heavy rain: deliveries may be late',
        body: 'Partners are riding carefully through the rain this evening. Thank you for your patience.',
        channels: ['IN_APP', 'EMAIL'],
      }),
    );
  // a promotion created by the zone lead waits for the Super Admin's approval (D135)
  if (!(await has('Weekend biryani festival')))
    await tryStep(log, 'promotion pending approval', () =>
      delegated.post('/notifications', {
        kind: 'PROMOTION',
        audience: 'CUSTOMERS',
        zoneIds: [zoneId['CBE']],
        title: 'Weekend biryani festival',
        body: 'Flat 20% off on biryanis from Haribhavanam and Kovai Biryani House this Saturday and Sunday.',
        channels: ['IN_APP', 'PUSH'],
        scheduledAt: new Date(Date.now() + 2 * 24 * 3_600_000).toISOString(),
      }),
    );
  // and one the zone lead created and the Super Admin approved: scheduled for tomorrow
  if (!(await has('Zero commission week for new vendors')))
    await tryStep(log, 'approved promotion', async () => {
      const p = await delegated.post<{ id: string; version: number }>('/notifications', {
        kind: 'PROMOTION',
        audience: 'VENDORS',
        zoneIds: [zoneId['CBE']],
        title: 'Zero commission week for new vendors',
        body: 'Join ZOAURO in Coimbatore Central this week and pay no commission on your first 50 orders.',
        channels: ['IN_APP', 'EMAIL'],
        scheduledAt: new Date(Date.now() + 26 * 3_600_000).toISOString(),
      });
      await sa.post(`/notifications/${p.id}/approve`, { version: p.version });
    });
  log('notifications: a message sent, a promotion pending approval, a scheduled promotion');
}
