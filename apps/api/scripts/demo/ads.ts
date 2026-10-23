import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { PrismaClient } from './db';
import { createS3Storage } from '../../src/lib/s3-storage';
import { DemoHttpError, type DemoClient } from './client';

// Step 15: Advertising & Commission (D179, D182, D201; ADS.md decisions). Platform terms v1 and v2, 13 slots, requests in
// every status and 7 campaigns in their final statuses (no sweep in the demo build). Every campaign time is on 00:00
// IST so billed days come out whole; the presenter reads the money from this step's log, never from the script.
// Request 5 is quoted through the API as Arun and request 7 rejected as Suresh (real audit rows); the rest are direct
// rows standing in for what the vendor app would have sent. Banners are flat-colour PNGs written straight to object
// storage at zone/{zoneId}/{vendorId}/{uuid}.png (D201: no presign, no hotel upload resolver). Idempotent: slots match on
// zone/page/placement/position, terms on version, requests on their vendor note, campaigns on their request.

type Log = (m: string) => void;
type Kind = 'RESTAURANT' | 'HOMEMAKER' | 'HOTEL';
type Page = 'HOME' | 'RESTAURANTS' | 'HOME_FOOD' | 'HOTELS';
type Placement = 'BANNER' | 'TOP_LISTING' | 'FEATURED';
type Pricing = 'FLAT_PER_DAY' | 'COMMISSION';

const DAY = 86_400_000;
const IST = 330 * 60_000;

async function tryStep<T>(log: Log, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log(
      `${what} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''} ${JSON.stringify(e.body).slice(0, 200)}` : e instanceof Error ? e.message.slice(0, 200) : 'error'}`,
    );
    return null;
  }
}

// ---- banner PNGs ---------------------------------------------------------------------------------------------------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A 600x200 left-to-right gradient PNG between two RGB colours (a few KB). */
export function bannerPng(from: [number, number, number], to: [number, number, number]): Buffer {
  const w = 600;
  const h = 200;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    for (let i = 0; i < 3; i++)
      row[1 + x * 3 + i] = Math.round((from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * t);
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- data ----------------------------------------------------------------------------------------------------------

interface SlotSpec {
  zone: string;
  page: Page;
  placement: Placement;
  position: number;
  capacity: number;
  pricing: Pricing;
  /** rupees per day, or the % */
  price: number;
  minDays?: number;
  status?: 'ACTIVE' | 'PAUSED' | 'RETIRED';
}
const SLOTS: SlotSpec[] = [
  {
    zone: 'CBE',
    page: 'HOME',
    placement: 'BANNER',
    position: 1,
    capacity: 2,
    pricing: 'FLAT_PER_DAY',
    price: 1500,
    minDays: 3,
  },
  {
    zone: 'CBE',
    page: 'HOME',
    placement: 'FEATURED',
    position: 1,
    capacity: 3,
    pricing: 'FLAT_PER_DAY',
    price: 800,
  },
  {
    zone: 'CBE',
    page: 'RESTAURANTS',
    placement: 'TOP_LISTING',
    position: 1,
    capacity: 1,
    pricing: 'COMMISSION',
    price: 4,
  },
  {
    zone: 'CBE',
    page: 'RESTAURANTS',
    placement: 'TOP_LISTING',
    position: 2,
    capacity: 1,
    pricing: 'COMMISSION',
    price: 3,
  },
  {
    zone: 'CBE',
    page: 'HOME_FOOD',
    placement: 'FEATURED',
    position: 1,
    capacity: 2,
    pricing: 'FLAT_PER_DAY',
    price: 400,
  },
  {
    zone: 'CBE',
    page: 'HOTELS',
    placement: 'BANNER',
    position: 1,
    capacity: 1,
    pricing: 'FLAT_PER_DAY',
    price: 1200,
  },
  {
    zone: 'CBE',
    page: 'RESTAURANTS',
    placement: 'BANNER',
    position: 1,
    capacity: 1,
    pricing: 'FLAT_PER_DAY',
    price: 1000,
    status: 'PAUSED',
  },
  {
    zone: 'CBN',
    page: 'HOME',
    placement: 'BANNER',
    position: 1,
    capacity: 1,
    pricing: 'FLAT_PER_DAY',
    price: 1000,
  },
  {
    zone: 'CBN',
    page: 'RESTAURANTS',
    placement: 'TOP_LISTING',
    position: 1,
    capacity: 1,
    pricing: 'COMMISSION',
    price: 3,
  },
  {
    zone: 'CBN',
    page: 'HOME_FOOD',
    placement: 'FEATURED',
    position: 1,
    capacity: 2,
    pricing: 'FLAT_PER_DAY',
    price: 300,
  },
  {
    zone: 'TUP',
    page: 'HOME',
    placement: 'BANNER',
    position: 1,
    capacity: 1,
    pricing: 'FLAT_PER_DAY',
    price: 700,
  },
  {
    zone: 'TUP',
    page: 'RESTAURANTS',
    placement: 'TOP_LISTING',
    position: 1,
    capacity: 1,
    pricing: 'COMMISSION',
    price: 3.5,
  },
  {
    zone: 'TUP',
    page: 'RESTAURANTS',
    placement: 'FEATURED',
    position: 1,
    capacity: 1,
    pricing: 'FLAT_PER_DAY',
    price: 500,
    status: 'RETIRED',
  },
];
const slotKey = (s: { zone: string; page: Page; placement: Placement; position: number }) =>
  `${s.zone}/${s.page}/${s.placement}/${s.position}`;

interface VendorSpec {
  zone: string;
  kind: Kind;
  name: string;
}
interface RequestSpec {
  /** unique: the idempotency key */
  note: string;
  vendor: VendorSpec;
  slot: string;
  startInDays: number;
  days: number;
  banner?: [[number, number, number], [number, number, number]];
  status: 'SUBMITTED' | 'QUOTE_API' | 'REJECT_API' | 'EXPIRED' | 'WITHDRAWN' | 'ACCEPTED';
  campaign?: {
    status: 'LIVE' | 'PAUSED' | 'ENDED' | 'SCHEDULED' | 'CANCELLED';
    pauseFromDays?: number;
    pauseReason?: string;
    cancelInDays?: number;
    cancelReason?: string;
  };
}
const V = (zone: string, kind: Kind, name: string): VendorSpec => ({ zone, kind, name });
const ORANGE: [number, number, number] = [255, 122, 0];
const RED: [number, number, number] = [214, 40, 57];
const TEAL: [number, number, number] = [0, 150, 136];
const BLUE: [number, number, number] = [33, 97, 196];
const GOLD: [number, number, number] = [240, 180, 40];
const PURPLE: [number, number, number] = [110, 60, 180];

const REQUESTS: RequestSpec[] = [
  {
    note: 'Top listing for our new biryani menu',
    vendor: V('CBE', 'RESTAURANT', 'Haribhavanam'),
    slot: 'CBE/RESTAURANTS/TOP_LISTING/1',
    startInDays: 3,
    days: 7,
    status: 'SUBMITTED',
  },
  {
    note: 'Feature our festival lunch boxes',
    vendor: V('CBE', 'HOMEMAKER', "Lakshmi's Home Kitchen"),
    slot: 'CBE/HOME_FOOD/FEATURED/1',
    startInDays: 2,
    days: 10,
    status: 'SUBMITTED',
  },
  {
    note: 'Hotels banner for the wedding season',
    vendor: V('CBE', 'HOTEL', 'The Residency Towers'),
    slot: 'CBE/HOTELS/BANNER/1',
    startInDays: 5,
    days: 14,
    banner: [BLUE, PURPLE],
    status: 'SUBMITTED',
  },
  {
    note: 'Home banner for the Deepavali sweets',
    vendor: V('CBE', 'RESTAURANT', 'Sree Krishna Sweets'),
    slot: 'CBE/HOME/BANNER/1',
    startInDays: 4,
    days: 7,
    status: 'SUBMITTED',
  },
  {
    note: 'Home banner for our breakfast combos',
    vendor: V('CBN', 'RESTAURANT', 'Saravanampatti Tiffin Centre'),
    slot: 'CBN/HOME/BANNER/1',
    startInDays: 3,
    days: 10,
    banner: [GOLD, ORANGE],
    status: 'QUOTE_API',
  },
  {
    note: 'Feature our veg lunch box',
    vendor: V('CBN', 'HOMEMAKER', 'Selvi Veg Lunch Box'),
    slot: 'CBN/HOME_FOOD/FEATURED/1',
    startInDays: -1,
    days: 7,
    status: 'EXPIRED',
  },
  {
    note: 'Home banner for Kongu specials',
    vendor: V('TUP', 'RESTAURANT', 'Tiruppur Kongu Kitchen'),
    slot: 'TUP/HOME/BANNER/1',
    startInDays: 6,
    days: 7,
    banner: [RED, GOLD],
    status: 'REJECT_API',
  },
  {
    note: 'Hotels banner for the conference halls',
    vendor: V('CBE', 'HOTEL', 'Hotel Annapoorna Residency'),
    slot: 'CBE/HOTELS/BANNER/1',
    startInDays: 8,
    days: 7,
    status: 'WITHDRAWN',
  },
  {
    note: 'Home banner for the anniversary week',
    vendor: V('CBE', 'RESTAURANT', 'Annapoorna Gowrishankar'),
    slot: 'CBE/HOME/BANNER/1',
    startInDays: -10,
    days: 20,
    banner: [ORANGE, RED],
    status: 'ACCEPTED',
    campaign: { status: 'LIVE' },
  },
  {
    note: 'Top listing in Restaurants',
    vendor: V('CBE', 'RESTAURANT', 'Annapoorna Gowrishankar'),
    slot: 'CBE/RESTAURANTS/TOP_LISTING/1',
    startInDays: -12,
    days: 30,
    status: 'ACCEPTED',
    campaign: { status: 'LIVE' },
  },
  {
    note: 'Feature us on the Home page',
    vendor: V('CBE', 'RESTAURANT', 'Haribhavanam'),
    slot: 'CBE/HOME/FEATURED/1',
    startInDays: -6,
    days: 14,
    status: 'ACCEPTED',
    campaign: { status: 'PAUSED', pauseFromDays: -2, pauseReason: 'Kitchen renovation' },
  },
  {
    note: 'Feature our weekday thali',
    vendor: V('CBE', 'HOMEMAKER', "Lakshmi's Home Kitchen"),
    slot: 'CBE/HOME_FOOD/FEATURED/1',
    startInDays: -10,
    days: 7,
    status: 'ACCEPTED',
    campaign: { status: 'ENDED' },
  },
  {
    note: 'Top listing in Coimbatore North',
    vendor: V('CBN', 'RESTAURANT', 'Saravanampatti Tiffin Centre'),
    slot: 'CBN/RESTAURANTS/TOP_LISTING/1',
    startInDays: 2,
    days: 14,
    status: 'ACCEPTED',
    campaign: { status: 'SCHEDULED' },
  },
  {
    note: 'Top listing in Tiruppur',
    vendor: V('TUP', 'RESTAURANT', 'Tiruppur Kongu Kitchen'),
    slot: 'TUP/RESTAURANTS/TOP_LISTING/1',
    startInDays: -5,
    days: 21,
    status: 'ACCEPTED',
    campaign: { status: 'LIVE' },
  },
  {
    note: 'Hotels banner for the summer offer',
    vendor: V('CBE', 'HOTEL', 'The Residency Towers'),
    slot: 'CBE/HOTELS/BANNER/1',
    startInDays: -12,
    days: 14,
    banner: [TEAL, BLUE],
    status: 'ACCEPTED',
    campaign: {
      status: 'CANCELLED',
      cancelInDays: -8,
      cancelReason: 'Vendor asked to stop: renovation',
    },
  },
];

const TERMS_BODY = (v: number) =>
  `ZOAURO advertising terms v${v}. Fees are deducted from the vendor's next payout. Unused days are not billed and the end date is fixed. Banner images must be the vendor's own. ZOAURO may pause an ad that breaks the content rules.`;

// ---- the step ------------------------------------------------------------------------------------------------------

export async function seedAds(
  db: PrismaClient,
  clients: { sa: DemoClient; suresh: DemoClient },
  zoneId: Record<string, string>,
  adminId: { primary: string; karthik: string; suresh: string },
  log: Log,
): Promise<void> {
  const now = new Date();
  // 00:00 IST today, as a UTC instant
  const today = new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST);
  const at = (days: number) => new Date(today.getTime() + days * DAY);
  const istDate = (d: Date) => new Date(new Date(d.getTime() + IST).toISOString().slice(0, 10));
  const adminOf = (zone: string) => (zone === 'TUP' ? adminId.suresh : adminId.karthik);

  // terms: v1 40 days ago, v2 (current) 15 days ago
  let termsId: string | null = null;
  for (const v of [1, 2]) {
    const found = await db.adTerms.findFirst({ where: { zoneId: null, version: v } });
    const row =
      found ??
      (await db.adTerms.create({
        data: {
          id: randomUUID(),
          zoneId: null,
          version: v,
          body: TERMS_BODY(v),
          createdAt: at(v === 1 ? -40 : -15),
          createdBy: adminId.primary,
        },
      }));
    termsId = row.id;
  }

  // slots
  const slots = new Map<string, { id: string; zoneId: string; pricing: Pricing; price: number }>();
  for (const s of SLOTS) {
    const z = zoneId[s.zone];
    if (!z) continue;
    await tryStep(log, `ad slot ${slotKey(s)}`, async () => {
      const found = await db.adSlot.findFirst({
        where: {
          zoneId: z,
          page: s.page,
          placement: s.placement,
          position: s.position,
          deletedAt: null,
        },
      });
      const row =
        found ??
        (await db.adSlot.create({
          data: {
            id: randomUUID(),
            zoneId: z,
            page: s.page,
            placement: s.placement,
            position: s.position,
            capacity: s.capacity,
            pricing: s.pricing,
            pricePerDayPaise: s.pricing === 'FLAT_PER_DAY' ? s.price * 100 : null,
            commissionPct: s.pricing === 'COMMISSION' ? s.price.toFixed(2) : null,
            minDays: s.minDays ?? 1,
            maxDays: 30,
            status: s.status ?? 'ACTIVE',
            createdBy: adminId.primary,
          },
        }));
      slots.set(slotKey(s), { id: row.id, zoneId: z, pricing: s.pricing, price: s.price });
    });
  }
  log(`ad slots: ${slots.size}`);

  const storage = process.env['S3_BUCKET']
    ? createS3Storage({
        bucket: process.env['S3_BUCKET'],
        region: process.env['S3_REGION'] ?? 'us-east-1',
        ...(process.env['S3_ENDPOINT'] ? { endpoint: process.env['S3_ENDPOINT'] } : {}),
      })
    : null;
  /** D201: the banner goes straight to object storage under the vendor's own prefix */
  const putBanner = async (
    z: string,
    vendorId: string,
    colours: [[number, number, number], [number, number, number]],
  ) => {
    if (!storage) throw new Error('S3_BUCKET is not set');
    const key = `zone/${z}/${vendorId}/${randomUUID()}.png`;
    const url = await storage.presignUpload(key, 'image/png');
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: bannerPng(...colours),
    });
    if (!res.ok) throw new Error(`banner upload ${res.status}`);
    return key;
  };
  const vendorRow = async (v: VendorSpec): Promise<string | null> => {
    const z = zoneId[v.zone];
    if (!z) return null;
    const where = { zoneId: z, status: 'ACTIVE' as const, deletedAt: null };
    const named = { ...where, name: { contains: v.name, mode: 'insensitive' as const } };
    const pick = (r: { id: string } | null) => r?.id ?? null;
    if (v.kind === 'RESTAURANT')
      return pick(
        (await db.restaurant.findFirst({ where: named, select: { id: true } })) ??
          (await db.restaurant.findFirst({
            where,
            select: { id: true },
            orderBy: { name: 'asc' },
          })),
      );
    if (v.kind === 'HOMEMAKER')
      return pick(
        (await db.homemaker.findFirst({ where: named, select: { id: true } })) ??
          (await db.homemaker.findFirst({ where, select: { id: true }, orderBy: { name: 'asc' } })),
      );
    return pick(
      (await db.hotel.findFirst({
        where: { zoneId: z, deletedAt: null, name: { contains: v.name, mode: 'insensitive' } },
        select: { id: true },
      })) ??
        (await db.hotel.findFirst({
          where: { zoneId: z, deletedAt: null },
          select: { id: true },
          orderBy: { name: 'asc' },
        })),
    );
  };

  let made = 0;
  for (const spec of REQUESTS) {
    await tryStep(log, `ad request "${spec.note}"`, async () => {
      const slot = slots.get(spec.slot);
      const z = zoneId[spec.vendor.zone];
      const vendorId = await vendorRow(spec.vendor);
      if (!slot || !z || !vendorId) throw new Error('slot, zone or vendor not found');
      const vendor =
        spec.vendor.kind === 'RESTAURANT'
          ? { restaurantId: vendorId }
          : spec.vendor.kind === 'HOMEMAKER'
            ? { homemakerId: vendorId }
            : { hotelId: vendorId };
      const [page, placement] = spec.slot.split('/').slice(1, 3) as [Page, Placement];
      const start = at(spec.startInDays);
      let request = await db.adRequest.findFirst({ where: { zoneId: z, vendorNote: spec.note } });
      if (!request) {
        const creativeKey = spec.banner
          ? await tryStep(log, `banner for "${spec.note}"`, () =>
              putBanner(z, vendorId, spec.banner ?? [ORANGE, RED]),
            )
          : null;
        const submittedAt = new Date(Math.min(now.getTime(), start.getTime()) - 5 * DAY);
        const quoted = spec.status === 'ACCEPTED' || spec.status === 'EXPIRED';
        const flat = slot.pricing === 'FLAT_PER_DAY';
        const quotedAt = new Date(submittedAt.getTime() + DAY);
        request = await db.adRequest.create({
          data: {
            id: randomUUID(),
            zoneId: z,
            ...vendor,
            page,
            placement,
            requestedStartDate: istDate(start),
            requestedDays: spec.days,
            creativeKey,
            vendorNote: spec.note,
            status:
              spec.status === 'QUOTE_API' || spec.status === 'REJECT_API'
                ? 'SUBMITTED'
                : spec.status,
            source: 'APP',
            submittedAt,
            ...(quoted
              ? {
                  slotId: slot.id,
                  quotedPricing: slot.pricing,
                  quotedPricePerDayPaise: flat ? slot.price * 100 : null,
                  quotedCommissionPct: flat ? null : slot.price.toFixed(2),
                  quotedTotalPaise: flat ? slot.price * 100 * spec.days : null,
                  quoteExpiresAt:
                    spec.status === 'EXPIRED' ? at(-2) : new Date(quotedAt.getTime() + 3 * DAY),
                  quotedAt: spec.status === 'EXPIRED' ? at(-5) : quotedAt,
                  quotedBy: adminOf(spec.vendor.zone),
                  termsId,
                }
              : {}),
            ...(spec.status === 'ACCEPTED'
              ? {
                  acceptedAt: new Date(quotedAt.getTime() + DAY / 2),
                  decidedAt: new Date(quotedAt.getTime() + DAY / 2),
                }
              : {}),
            ...(spec.status === 'WITHDRAWN' ? { decidedAt: at(-1) } : {}),
          },
        });
        made++;
      }

      // admin decisions through the API (real audit rows)
      if (spec.status === 'QUOTE_API' && request.status === 'SUBMITTED')
        await clients.sa.postVersioned(`/ads/requests/${request.id}/quote`, request.version, {
          slotId: slot.id,
          note: 'Launch offer at the list price',
        });
      if (spec.status === 'REJECT_API' && request.status === 'SUBMITTED')
        await clients.suresh.postVersioned(`/ads/requests/${request.id}/reject`, request.version, {
          reason: "The banner shows another brand's logo; please upload your own",
        });

      // the campaign of an accepted request, in its final status
      if (spec.campaign && spec.status === 'ACCEPTED') {
        const c = spec.campaign;
        if (await db.adCampaign.findFirst({ where: { requestId: request.id } })) return;
        const end = at(spec.startInDays + spec.days);
        const flat = slot.pricing === 'FLAT_PER_DAY';
        const cancelledAt = c.status === 'CANCELLED' ? at(c.cancelInDays ?? 0) : null;
        await db.adCampaign.create({
          data: {
            id: randomUUID(),
            zoneId: z,
            slotId: slot.id,
            requestId: request.id,
            ...vendor,
            startAt: start,
            endAt: end,
            status: c.status,
            pricing: slot.pricing,
            pricePerDayPaise: flat ? slot.price * 100 : null,
            commissionPct: flat ? null : slot.price.toFixed(2),
            termsId,
            creativeKey: request.creativeKey,
            pausesJson:
              c.pauseFromDays !== undefined
                ? [{ from: at(c.pauseFromDays).toISOString(), to: null }]
                : [],
            pausedAt: c.pauseFromDays !== undefined ? at(c.pauseFromDays) : null,
            cancelledAt,
            cancelReason: c.cancelReason ?? null,
            endedAt: c.status === 'ENDED' ? end : null,
            createdBy: adminOf(spec.vendor.zone),
          },
        });
      }
    });
  }
  log(`ad requests: ${made} new of ${REQUESTS.length}`);

  // the figures for the presenter (they move with the run day; read them here, never from the script)
  await tryStep(log, 'ads figures', async () => {
    const live = await clients.sa.get<{
      data: {
        vendor: { name: string };
        slot: { label: string };
        liveDays: number;
        earnedPaise: number | null;
      }[];
    }>('/ads/campaigns?pageSize=50');
    for (const c of live.data)
      log(
        `  campaign ${c.vendor.name} · ${c.slot.label}: ${c.liveDays} billed days, earned ₹${((c.earnedPaise ?? 0) / 100).toLocaleString('en-IN')}`,
      );
    const d = await clients.sa.get<{
      counts: Record<string, number>;
      money: {
        flatBilledPaise: number;
        commissionEarnedPaise: number;
        totalEarnedPaise: number;
        dueFromPayoutsPaise: number;
        billedToHotelsPaise: number;
      } | null;
    }>('/ads/dashboard');
    log(`  dashboard counts ${JSON.stringify(d.counts)}`);
    if (d.money) {
      const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
      const m = d.money;
      log(
        `  dashboard money: flat ${rupees(m.flatBilledPaise)}, commission ${rupees(m.commissionEarnedPaise)}, total ${rupees(m.totalEarnedPaise)}, due from payouts ${rupees(m.dueFromPayoutsPaise)}, billed to hotels ${rupees(m.billedToHotelsPaise)}`,
      );
    }
  });
}
