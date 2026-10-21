import type { PrismaClient } from './db';
import { DEFAULT_ONBOARDING_DOCUMENTS } from '@zoauro/shared';
import type { DemoClient } from './client';
import { SAMPLE_PNG, samplePdf, upload } from './files';

// Step 2: restaurants, shops and home food at every onboarding and operating stage, with documents in object storage.

type Stage = 'LIVE' | 'REVIEW' | 'NEW' | 'REJECTED' | 'SUSPENDED' | 'INACTIVE';
type Module = 'restaurants' | 'homemakers';

interface VendorSpec {
  module: Module;
  zone: string;
  name: string;
  owner: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  tags: string[];
  stage: Stage;
  kind?: 'RESTAURANT' | 'SHOP';
  commissionPct?: number;
  minOrderPaise?: number;
  foodCategory?: string;
  experienceYears?: number;
  dailyCapacity?: number;
}

const R = (o: Omit<VendorSpec, 'module'>): VendorSpec => ({ module: 'restaurants', ...o });
const H = (o: Omit<VendorSpec, 'module'>): VendorSpec => ({ module: 'homemakers', ...o });

export const VENDORS: VendorSpec[] = [
  // Coimbatore Central
  R({
    zone: 'CBE',
    name: 'Annapoorna Gowrishankar',
    owner: 'K. Ramasamy',
    area: 'RS Puram',
    address: '75 DB Road, RS Puram, Coimbatore 641002',
    lat: 11.0089,
    lng: 76.9497,
    tags: ['South Indian', 'Vegetarian'],
    stage: 'LIVE',
    commissionPct: 18,
    minOrderPaise: 15000,
  }),
  R({
    zone: 'CBE',
    name: 'Haribhavanam',
    owner: 'S. Balasubramaniam',
    area: 'Gandhipuram',
    address: '12 Cross Cut Road, Gandhipuram, Coimbatore 641012',
    lat: 11.0183,
    lng: 76.9725,
    tags: ['Chettinad', 'Biryani'],
    stage: 'LIVE',
    commissionPct: 20,
    minOrderPaise: 20000,
  }),
  R({
    zone: 'CBE',
    name: 'Sree Krishna Sweets',
    owner: 'M. Murali',
    area: 'Race Course',
    address: '4 West Club Road, Race Course, Coimbatore 641018',
    lat: 11.0005,
    lng: 76.9806,
    tags: ['Sweets', 'Savouries'],
    stage: 'LIVE',
    kind: 'SHOP',
    commissionPct: 12,
  }),
  R({
    zone: 'CBE',
    name: 'Kovai Biryani House',
    owner: 'A. Mohammed Rafi',
    area: 'Ukkadam',
    address: '33 Big Bazaar Street, Ukkadam, Coimbatore 641001',
    lat: 10.9925,
    lng: 76.9614,
    tags: ['Biryani', 'Mughlai'],
    stage: 'REVIEW',
    commissionPct: 18,
  }),
  R({
    zone: 'CBE',
    name: 'Spice Route Kitchen',
    owner: 'R. Dinesh',
    area: 'Peelamedu',
    address: '210 Avinashi Road, Peelamedu, Coimbatore 641004',
    lat: 11.0262,
    lng: 77.0028,
    tags: ['North Indian', 'Chinese'],
    stage: 'REJECTED',
  }),
  R({
    zone: 'CBE',
    name: 'Rajam Mess',
    owner: 'V. Rajam',
    area: 'Town Hall',
    address: '9 Raja Street, Town Hall, Coimbatore 641001',
    lat: 10.9948,
    lng: 76.9618,
    tags: ['Meals', 'South Indian'],
    stage: 'SUSPENDED',
    commissionPct: 15,
  }),
  H({
    zone: 'CBE',
    name: "Lakshmi's Home Kitchen",
    owner: 'Lakshmi Narayanan',
    area: 'Saibaba Colony',
    address: '18 NSR Road, Saibaba Colony, Coimbatore 641011',
    lat: 11.0244,
    lng: 76.9416,
    tags: ['Kongu', 'Meals'],
    stage: 'LIVE',
    commissionPct: 10,
    foodCategory: 'Vegetarian meals',
    experienceYears: 14,
    dailyCapacity: 40,
  }),
  H({
    zone: 'CBE',
    name: 'Amma Samayal',
    owner: 'Meenakshi Sundar',
    area: 'Ganapathy',
    address: '6 Sathy Road, Ganapathy, Coimbatore 641006',
    lat: 11.0384,
    lng: 76.9773,
    tags: ['Chettinad'],
    stage: 'REVIEW',
    foodCategory: 'Non-veg meals',
    experienceYears: 8,
    dailyCapacity: 25,
  }),
  H({
    zone: 'CBE',
    name: "Kavitha's Millet Meals",
    owner: 'Kavitha Ravi',
    area: 'Singanallur',
    address: '41 Trichy Road, Singanallur, Coimbatore 641005',
    lat: 10.9985,
    lng: 77.0281,
    tags: ['Millets', 'Healthy'],
    stage: 'REJECTED',
    foodCategory: 'Millet meals',
    experienceYears: 3,
  }),
  // Coimbatore North
  R({
    zone: 'CBN',
    name: 'Saravanampatti Tiffin Centre',
    owner: 'P. Senthil',
    area: 'Saravanampatti',
    address: '2 Sathy Main Road, Saravanampatti, Coimbatore 641035',
    lat: 11.0797,
    lng: 76.9981,
    tags: ['Tiffin', 'South Indian'],
    stage: 'LIVE',
    commissionPct: 16,
    minOrderPaise: 10000,
  }),
  R({
    zone: 'CBN',
    name: 'The Brew Room Cafe',
    owner: 'Nikhil Menon',
    area: 'Thudiyalur',
    address: '88 Mettupalayam Road, Thudiyalur, Coimbatore 641034',
    lat: 11.0781,
    lng: 76.9432,
    tags: ['Cafe', 'Bakery'],
    stage: 'INACTIVE',
    commissionPct: 20,
  }),
  R({
    zone: 'CBN',
    name: 'Thudiyalur Dosa Corner',
    owner: 'G. Kannan',
    area: 'Thudiyalur',
    address: '15 Vellakinar Road, Thudiyalur, Coimbatore 641034',
    lat: 11.0764,
    lng: 76.9461,
    tags: ['Dosa'],
    stage: 'NEW',
  }),
  H({
    zone: 'CBN',
    name: 'Selvi Veg Lunch Box',
    owner: 'Selvi Murugan',
    area: 'Kovilpalayam',
    address: '27 Kovilpalayam Main Road, Coimbatore 641107',
    lat: 11.1265,
    lng: 77.0085,
    tags: ['Lunch box', 'Vegetarian'],
    stage: 'LIVE',
    commissionPct: 10,
    foodCategory: 'Office lunch boxes',
    experienceYears: 6,
    dailyCapacity: 60,
  }),
  // Tiruppur
  R({
    zone: 'TUP',
    name: 'Tiruppur Kongu Kitchen',
    owner: 'N. Palanisamy',
    area: 'Kumaran Road',
    address: '101 Kumaran Road, Tiruppur 641601',
    lat: 11.1085,
    lng: 77.3411,
    tags: ['Kongu', 'Non-veg'],
    stage: 'LIVE',
    commissionPct: 17,
    minOrderPaise: 15000,
  }),
  R({
    zone: 'TUP',
    name: 'Arya Bhavan',
    owner: 'T. Shankar',
    area: 'Avinashi Road',
    address: '56 Avinashi Road, Tiruppur 641603',
    lat: 11.1201,
    lng: 77.3264,
    tags: ['South Indian', 'Vegetarian'],
    stage: 'REVIEW',
  }),
  H({
    zone: 'TUP',
    name: 'Ganga Home Foods',
    owner: 'Gangadevi Prakash',
    area: 'Palladam Road',
    address: '7 Palladam Road, Tiruppur 641604',
    lat: 11.0943,
    lng: 77.3302,
    tags: ['Snacks', 'Sweets'],
    stage: 'NEW',
    foodCategory: 'Evening snacks',
    experienceYears: 5,
    dailyCapacity: 30,
  }),
];

const HOURS = (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((day) => ({
  day,
  isOpen: true,
  opens: day === 'SUN' ? '09:00' : '07:30',
  closes: '22:30',
}));

interface VendorDetail {
  id: string;
  documents: { id: string; docType: string; status: string }[];
  verificationStatus: string;
  status: string;
}

export interface SeededVendor {
  id: string;
  module: Module;
  zone: string;
  zoneId: string;
  name: string;
  stage: Stage;
}

type Log = (m: string) => void;

export async function seedVendors(
  db: PrismaClient,
  sa: DemoClient,
  zoneId: Record<string, string>,
  log: Log,
): Promise<SeededVendor[]> {
  const out: SeededVendor[] = [];
  let i = 0;
  for (const v of VENDORS) {
    i += 1;
    const zid = zoneId[v.zone] ?? '';
    const existing =
      v.module === 'restaurants'
        ? await db.restaurant.findFirst({
            where: { name: v.name, zoneId: zid, deletedAt: null },
            select: { id: true },
          })
        : await db.homemaker.findFirst({
            where: { name: v.name, zoneId: zid, deletedAt: null },
            select: { id: true },
          });
    if (existing) {
      out.push({
        id: existing.id,
        module: v.module,
        zone: v.zone,
        zoneId: zid,
        name: v.name,
        stage: v.stage,
      });
      continue;
    }
    const common = {
      zoneId: zid,
      name: v.name,
      phone: `+9198${String(4300 + i).padStart(4, '0')}${String(1000 + i * 37).slice(-4)}`,
      email: `${v.name
        .toLowerCase()
        .replace(/[^a-z]+/g, '.')
        .replace(/^\.|\.$/g, '')}@vendors.zoauro.demo`,
      address: v.address,
      area: v.area,
      lat: v.lat,
      lng: v.lng,
      ...(v.commissionPct !== undefined ? { commissionPct: v.commissionPct } : {}),
      ...(v.minOrderPaise !== undefined ? { minOrderPaise: v.minOrderPaise } : {}),
      fssaiNo: `1242${String(100000 + i * 7919).slice(0, 6)}${String(1000 + i).slice(-4)}`.slice(
        0,
        14,
      ),
      openingHours: HOURS,
    };
    const created =
      v.module === 'restaurants'
        ? await sa.post<VendorDetail>('/restaurants', {
            ...common,
            kind: v.kind ?? 'RESTAURANT',
            ownerName: v.owner,
            cuisineTags: v.tags,
            gstNo: `33AABC${String(1000 + i)}F1Z${i % 10}`,
          })
        : await sa.post<VendorDetail>('/homemakers', {
            ...common,
            specialityTags: v.tags,
            ...(v.foodCategory ? { foodCategory: v.foodCategory } : {}),
            ...(v.experienceYears !== undefined ? { experienceYears: v.experienceYears } : {}),
            ...(v.dailyCapacity !== undefined ? { dailyCapacity: v.dailyCapacity } : {}),
          });
    const id = created.id;
    await onboard(sa, v, id, zid);
    log(
      `${v.module === 'restaurants' ? (v.kind === 'SHOP' ? 'shop' : 'restaurant') : 'home food'} ${v.name} (${v.zone}): ${v.stage}`,
    );
    out.push({ id, module: v.module, zone: v.zone, zoneId: zid, name: v.name, stage: v.stage });
  }
  return out;
}

/** Documents, reviews, verification and status for one vendor's stage. */
async function onboard(sa: DemoClient, v: VendorSpec, id: string, zoneId: string): Promise<void> {
  if (v.stage === 'NEW') return;
  const party = v.module === 'restaurants' ? 'RESTAURANT' : 'HOMEMAKER';
  const catalogue = DEFAULT_ONBOARDING_DOCUMENTS[party] ?? [];
  // REVIEW: the mandatory documents arrive but one is still missing, so the checklist shows the gap
  const docs = v.stage === 'REVIEW' ? catalogue.filter((d) => d.mandatory).slice(0, -1) : catalogue;
  for (const d of docs) {
    const photo = d.code === 'KITCHEN_PHOTOS';
    const fileKey = await upload(sa, {
      purpose: 'VENDOR_DOC',
      zoneId,
      entityId: id,
      file: photo ? SAMPLE_PNG : samplePdf(d.label, v.name),
      contentType: photo ? 'image/png' : 'application/pdf',
    });
    await sa.post(`/${v.module}/${id}/documents`, { docType: d.code, fileKey });
  }
  if (v.stage === 'REVIEW') return;

  const detail = await sa.get<VendorDetail>(`/${v.module}/${id}`);
  for (const d of detail.documents) {
    const reject =
      v.stage === 'REJECTED' && (d.docType === 'FSSAI' || d.docType === 'FSSAI_REGISTRATION');
    await sa.post(`/${v.module}/${id}/documents/${d.id}/verify`, {
      decision: reject ? 'REJECTED' : 'VERIFIED',
      ...(reject
        ? { note: 'The FSSAI licence expired in March; upload the renewed licence.' }
        : {}),
    });
  }
  if (v.stage === 'REJECTED') {
    await sa.post(`/${v.module}/${id}/verification`, {
      decision: 'REJECTED',
      note: 'FSSAI licence expired. Re-apply with the renewed licence.',
    });
    return;
  }
  await sa.post(`/${v.module}/${id}/verification`, { decision: 'VERIFIED' });
  await sa.post(`/${v.module}/${id}/status`, { status: 'ACTIVE' });
  if (v.stage === 'SUSPENDED')
    await sa.post(`/${v.module}/${id}/status`, {
      status: 'SUSPENDED',
      reason: 'Three hygiene complaints this month; inspection scheduled.',
    });
  if (v.stage === 'INACTIVE')
    await sa.post(`/${v.module}/${id}/status`, {
      status: 'INACTIVE',
      reason: 'Closed for renovation until next month.',
    });
}
