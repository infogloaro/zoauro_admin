import type { PrismaClient } from './db';
import type { DemoClient } from './client';
import { DemoHttpError } from './client';

// Step 5: customers with addresses in each live zone (added through the D28 admin flow), most marked as registered
// from the customer app, two blocked; reward points through the admin adjust and convert routes (D169).

interface CustomerSpec {
  name: string;
  zone: 'CBE' | 'CBN' | 'TUP';
  area: string;
  address: string;
  pincode: string;
  email?: string;
  blocked?: string;
  points?: number;
  convert?: number;
}

export const CUSTOMERS: CustomerSpec[] = [
  {
    name: 'Aarthi Subramanian',
    zone: 'CBE',
    area: 'RS Puram',
    address: '14 Lawley Road, RS Puram',
    pincode: '641002',
    email: 'aarthi.s@example.in',
    points: 500,
    convert: 200,
  },
  {
    name: 'Bharath Kumar',
    zone: 'CBE',
    area: 'Gandhipuram',
    address: '3 Nehru Street, Gandhipuram',
    pincode: '641012',
    points: 250,
  },
  {
    name: 'Charulatha Mohan',
    zone: 'CBE',
    area: 'Peelamedu',
    address: '221 Avinashi Road, Peelamedu',
    pincode: '641004',
    email: 'charu.m@example.in',
    points: 1200,
  },
  {
    name: 'Deepak Raj',
    zone: 'CBE',
    area: 'Saibaba Colony',
    address: '9 Bharathi Park Road, Saibaba Colony',
    pincode: '641011',
  },
  {
    name: 'Ezhil Arasan',
    zone: 'CBE',
    area: 'Ramanathapuram',
    address: '45 Trichy Road, Ramanathapuram',
    pincode: '641015',
    points: 100,
  },
  {
    name: 'Fathima Begum',
    zone: 'CBE',
    area: 'Ukkadam',
    address: '7 Selvapuram Main Road, Ukkadam',
    pincode: '641001',
    email: 'fathima.b@example.in',
  },
  {
    name: 'Gayathri Srinivasan',
    zone: 'CBE',
    area: 'Race Course',
    address: '2 Kamaraj Road, Race Course',
    pincode: '641018',
    points: 800,
  },
  {
    name: 'Hariharan Venkat',
    zone: 'CBE',
    area: 'Singanallur',
    address: '61 Kamarajar Road, Singanallur',
    pincode: '641005',
    blocked: 'Repeated refund claims on delivered orders (5 in 30 days).',
  },
  {
    name: 'Indhumathi Palani',
    zone: 'CBE',
    area: 'Ganapathy',
    address: '18 Sathy Road, Ganapathy',
    pincode: '641006',
    points: 300,
  },
  {
    name: 'Jayakumar Sekar',
    zone: 'CBE',
    area: 'Town Hall',
    address: '5 Oppanakara Street, Town Hall',
    pincode: '641001',
  },
  {
    name: 'Keerthana Rajan',
    zone: 'CBE',
    area: 'Puliyakulam',
    address: '33 Puliyakulam Road',
    pincode: '641016',
    email: 'keerthana.r@example.in',
    points: 150,
  },
  {
    name: 'Lokesh Anand',
    zone: 'CBE',
    area: 'Sowripalayam',
    address: '12 Sowripalayam Road',
    pincode: '641019',
  },
  {
    name: 'Madhavan Iyer',
    zone: 'CBN',
    area: 'Saravanampatti',
    address: '8 Keeranatham Road, Saravanampatti',
    pincode: '641035',
    points: 400,
  },
  {
    name: 'Nandhini Sivakumar',
    zone: 'CBN',
    area: 'Thudiyalur',
    address: '27 NGGO Colony, Thudiyalur',
    pincode: '641034',
    email: 'nandhini.s@example.in',
  },
  {
    name: 'Oviya Shanmugam',
    zone: 'CBN',
    area: 'Kovilpalayam',
    address: '4 Annur Road, Kovilpalayam',
    pincode: '641030',
    points: 220,
  },
  {
    name: 'Praveen Chandran',
    zone: 'CBN',
    area: 'Vadavalli',
    address: '19 Marudhamalai Road, Vadavalli',
    pincode: '641024',
  },
  {
    name: 'Ramya Krishnan',
    zone: 'CBN',
    area: 'Kalapatti',
    address: '52 Kalapatti Main Road',
    pincode: '641035',
    blocked: 'Abusive language to delivery partners (two reports).',
  },
  {
    name: 'Sathish Babu',
    zone: 'CBN',
    area: 'Vilankurichi',
    address: '6 Vilankurichi Road',
    pincode: '641035',
    points: 90,
  },
  {
    name: 'Tamilselvi Ganesan',
    zone: 'TUP',
    area: 'Kumaran Road',
    address: '77 Kumaran Road',
    pincode: '641601',
    points: 350,
  },
  {
    name: 'Udhayakumar Ravi',
    zone: 'TUP',
    area: 'Avinashi Road',
    address: '140 Avinashi Road',
    pincode: '641603',
    email: 'udhaya.r@example.in',
  },
  {
    name: 'Vasanthi Mani',
    zone: 'TUP',
    area: 'Palladam Road',
    address: '23 Palladam Road',
    pincode: '641604',
    points: 600,
    convert: 300,
  },
  {
    name: 'Yuvaraj Natarajan',
    zone: 'TUP',
    area: 'Kangeyam Road',
    address: '11 Kangeyam Road',
    pincode: '641607',
  },
  {
    name: 'Zainab Ali',
    zone: 'TUP',
    area: 'College Road',
    address: '38 College Road',
    pincode: '641602',
    points: 120,
  },
  {
    name: 'Anbu Selvan',
    zone: 'TUP',
    area: 'Mangalam Road',
    address: '2 Mangalam Road',
    pincode: '641605',
  },
];

export interface SeededCustomer {
  id: string;
  name: string;
  phone: string;
  zone: string;
  zoneId: string;
  addressId: string | null;
  address: string;
  pincode: string;
  blocked: boolean;
}

type Log = (m: string) => void;

export async function seedCustomers(
  db: PrismaClient,
  sa: DemoClient,
  zoneId: Record<string, string>,
  log: Log,
): Promise<SeededCustomer[]> {
  const out: SeededCustomer[] = [];
  let created = 0;
  for (const [i, c] of CUSTOMERS.entries()) {
    const phone = `+9199${String(4400 + i).padStart(4, '0')}${String(5000 + i * 61).slice(-4)}`;
    const zid = zoneId[c.zone] ?? '';
    let row = await db.customer.findUnique({
      where: { phone },
      select: { id: true, status: true },
    });
    if (!row) {
      const r = await sa.post<{ id: string }>('/customers', {
        name: c.name,
        phone,
        ...(c.email ? { email: c.email } : {}),
        address: {
          zoneId: zid,
          label: 'Home',
          address: `${c.address}, ${c.zone === 'TUP' ? 'Tiruppur' : 'Coimbatore'}`,
          area: c.area,
          pincode: c.pincode,
        },
      });
      row = { id: r.id, status: 'ACTIVE' };
      created += 1;
      // most demo customers came through the customer app (doc 44: the app is the profile's writer)
      if (i % 4 !== 3) await db.customer.update({ where: { id: r.id }, data: { source: 'APP' } });
      for (const [points, reason] of c.points
        ? ([[c.points, 'Welcome bonus for the first order']] as const)
        : []) {
        await adjust(sa, r.id, points, reason, log);
      }
      if (c.convert) {
        await sa
          .post(`/customers/${r.id}/rewards/convert`, { points: c.convert })
          .catch((e: unknown) =>
            log(`convert for ${c.name} skipped: ${e instanceof DemoHttpError ? e.code : 'error'}`),
          );
      }
      if (c.blocked) await sa.post(`/customers/${r.id}/block`, { reason: c.blocked });
    }
    const addr = await db.customerAddress.findFirst({
      where: { customerId: row.id, deletedAt: null },
      select: { id: true },
    });
    out.push({
      id: row.id,
      name: c.name,
      phone,
      zone: c.zone,
      zoneId: zid,
      addressId: addr?.id ?? null,
      address: `${c.address}, ${c.zone === 'TUP' ? 'Tiruppur' : 'Coimbatore'} ${c.pincode}`,
      pincode: c.pincode,
      blocked: Boolean(c.blocked),
    });
  }
  log(
    `customers: ${created} added (${out.length} in all, ${out.filter((c) => c.blocked).length} blocked)`,
  );
  return out;
}

async function adjust(
  sa: DemoClient,
  id: string,
  points: number,
  reason: string,
  log: Log,
): Promise<void> {
  try {
    await sa.post(`/customers/${id}/rewards/adjust`, { points, reason });
  } catch (e) {
    log(
      `reward adjust skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''}` : 'error'}`,
    );
  }
}
