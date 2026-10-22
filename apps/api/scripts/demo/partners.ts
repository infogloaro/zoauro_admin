import type { PrismaClient } from './db';
import { DEFAULT_ONBOARDING_DOCUMENTS } from '@zoauro/shared';
import { runWithAuditContext } from '../../src/lib/audit';
import { RegistrationsDatabase } from '../../src/modules/intake/registrations.repository';
import { RegistrationsService } from '../../src/modules/intake/registrations.service';
import type { DemoClient } from './client';
import { samplePdf, upload } from './files';

// Step 4: delivery partners at every stage (admin-added: verified and active, suspended, inactive, rejected, forced
// offline) and Partner Requests from the partner app (pending; one whose pincode no zone covers: "Needs a zone").

type Stage = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'REJECTED' | 'OFFLINE';

interface PartnerSpec {
  zone: string;
  name: string;
  vehicleType: string;
  vehicleNo: string;
  area: string;
  stage: Stage;
}

const ADMIN_PARTNERS: PartnerSpec[] = [
  {
    zone: 'CBE',
    name: 'Mani Kandan',
    vehicleType: 'Bike',
    vehicleNo: 'TN66AB1234',
    area: 'RS Puram',
    stage: 'ACTIVE',
  },
  {
    zone: 'CBE',
    name: 'Arjun Selvam',
    vehicleType: 'Scooter',
    vehicleNo: 'TN37CK4521',
    area: 'Gandhipuram',
    stage: 'ACTIVE',
  },
  {
    zone: 'CBE',
    name: 'Vignesh Ramesh',
    vehicleType: 'Bike',
    vehicleNo: 'TN38BX7788',
    area: 'Peelamedu',
    stage: 'OFFLINE',
  },
  {
    zone: 'CBE',
    name: 'Saravanan Pandian',
    vehicleType: 'Bike',
    vehicleNo: 'TN66Z9001',
    area: 'Ukkadam',
    stage: 'SUSPENDED',
  },
  {
    zone: 'CBE',
    name: 'Rahul Mohan',
    vehicleType: 'Bicycle',
    vehicleNo: 'TN66AA1010',
    area: 'Race Course',
    stage: 'REJECTED',
  },
  {
    zone: 'CBN',
    name: 'Gokul Krishnan',
    vehicleType: 'Bike',
    vehicleNo: 'TN38DE3344',
    area: 'Saravanampatti',
    stage: 'ACTIVE',
  },
  {
    zone: 'CBN',
    name: 'Bala Murugan',
    vehicleType: 'Scooter',
    vehicleNo: 'TN38FG5566',
    area: 'Thudiyalur',
    stage: 'INACTIVE',
  },
  {
    zone: 'TUP',
    name: 'Murugan Velu',
    vehicleType: 'Bike',
    vehicleNo: 'TN39H7070',
    area: 'Kumaran Road',
    stage: 'ACTIVE',
  },
  {
    zone: 'TUP',
    name: 'Ravi Shankar',
    vehicleType: 'Bike',
    vehicleNo: 'TN39K2525',
    area: 'Avinashi Road',
    stage: 'ACTIVE',
  },
];

/** Sign-ups from the partner app (doc 42 section 5.4): pending verification; PIN 999999 matches no zone. */
const APP_SIGNUPS = [
  {
    partnerId: 'app-partner-1101',
    name: 'Dhanush Kumar',
    vehicleType: 'Bike',
    vehicleNo: 'TN66CD2211',
    area: 'Saibaba Colony',
    pincode: '641011',
  },
  {
    partnerId: 'app-partner-1102',
    name: 'Ajith Raj',
    vehicleType: 'Scooter',
    vehicleNo: 'TN38GH6677',
    area: 'Kovilpalayam',
    pincode: '641030',
  },
  {
    partnerId: 'app-partner-1103',
    name: 'Prakash Natarajan',
    vehicleType: 'Bike',
    vehicleNo: 'TN39M4455',
    area: 'Palladam Road',
    pincode: '641604',
  },
  {
    partnerId: 'app-partner-1104',
    name: 'Imran Basha',
    vehicleType: 'Bike',
    vehicleNo: 'TN41P8899',
    area: 'Mettupalayam',
    pincode: '641301',
  },
];

export interface SeededPartner {
  id: string;
  zone: string;
  zoneId: string;
  name: string;
  stage: Stage | 'APP_PENDING';
}

type Log = (m: string) => void;

export async function seedPartners(
  db: PrismaClient,
  sa: DemoClient,
  zoneId: Record<string, string>,
  partnerAppClientId: string,
  log: Log,
): Promise<SeededPartner[]> {
  const out: SeededPartner[] = [];
  let n = 0;
  for (const p of ADMIN_PARTNERS) {
    n += 1;
    const zid = zoneId[p.zone] ?? '';
    const found = await db.deliveryPartner.findFirst({
      where: { name: p.name, deletedAt: null },
      select: { id: true },
    });
    if (found) {
      out.push({ id: found.id, zone: p.zone, zoneId: zid, name: p.name, stage: p.stage });
      continue;
    }
    const created = await sa.post<{ id: string; version: number }>('/delivery-partners', {
      zoneId: zid,
      name: p.name,
      phone: `+9197${String(5100 + n).padStart(4, '0')}${String(2000 + n * 53).slice(-4)}`,
      vehicleType: p.vehicleType,
      vehicleNo: p.vehicleNo,
      area: p.area,
    });
    const id = created.id;
    for (const d of DEFAULT_ONBOARDING_DOCUMENTS.DELIVERY_PARTNER ?? []) {
      const fileKey = await upload(sa, {
        purpose: 'PARTNER_DOC',
        zoneId: zid,
        entityId: id,
        file: samplePdf(d.label, p.name),
        contentType: 'application/pdf',
      });
      await sa.post(`/delivery-partners/${id}/documents`, { docType: d.code, fileKey });
    }
    const detail = await sa.get<{ documents: { id: string; docType: string }[] }>(
      `/delivery-partners/${id}`,
    );
    for (const d of detail.documents) {
      const reject = p.stage === 'REJECTED' && d.docType === 'DRIVING_LICENCE';
      await sa.post(`/delivery-partners/${id}/documents/${d.id}/verify`, {
        decision: reject ? 'REJECTED' : 'VERIFIED',
        ...(reject ? { note: 'A learner licence cannot be used for deliveries.' } : {}),
      });
    }
    if (p.stage === 'REJECTED') {
      await sa.post(`/delivery-partners/${id}/verification`, {
        decision: 'REJECTED',
        note: 'Needs a permanent driving licence; re-apply after the test.',
      });
    } else {
      await sa.post(`/delivery-partners/${id}/verification`, { decision: 'VERIFIED' });
      await sa.post(`/delivery-partners/${id}/status`, { status: 'ACTIVE' });
      if (p.stage === 'SUSPENDED')
        await sa.post(`/delivery-partners/${id}/status`, {
          status: 'SUSPENDED',
          reason: 'Two COD hand-overs short this week; on hold until settled.',
        });
      if (p.stage === 'INACTIVE')
        await sa.post(`/delivery-partners/${id}/status`, {
          status: 'INACTIVE',
          reason: 'On leave for two weeks.',
        });
      if (p.stage === 'OFFLINE')
        await sa.post(`/delivery-partners/${id}/force-offline`, {
          reason: 'Rider safety check after a minor accident.',
          until: new Date(Date.now() + 2 * 24 * 3_600_000).toISOString(),
        });
    }
    log(`partner ${p.name} (${p.zone}): ${p.stage}`);
    out.push({ id, zone: p.zone, zoneId: zid, name: p.name, stage: p.stage });
  }

  // "online" is the partner app's own field (doc 44): the active partners are on duty for the demo; their last
  // location (lat, lng and time together, D154) is refreshed on every seed by refreshPartnerLocations
  const onDuty = out.filter((p) => p.stage === 'ACTIVE').map((p) => p.id);
  await db.deliveryPartner.updateMany({ where: { id: { in: onDuty } }, data: { isOnline: true } });

  // Partner Requests from the partner app, through the real sign-up service as that app (IH-2)
  const registrations = new RegistrationsService(new RegistrationsDatabase(db));
  const client = {
    id: partnerAppClientId,
    name: 'Partner app (demo sandbox)',
    type: 'PARTNER_APP' as const,
    environment: 'SANDBOX' as const,
    scopes: ['partners:register'],
  };
  for (const [i, s] of APP_SIGNUPS.entries()) {
    const r = await runWithAuditContext(
      { actor: { type: 'APP_CLIENT', id: client.id, name: client.name, role: null } },
      () =>
        registrations.registerPartner(
          client,
          {
            ...s,
            phone: `+9196${String(7700 + i).padStart(4, '0')}${String(3100 + i * 41).slice(-4)}`,
          },
          new Date(),
        ),
    );
    if (r.httpStatus !== 200) log(`partner request ${s.name} from the app: ${r.ref.zoneStatus}`);
    out.push({
      id: r.ref.id,
      zone: '',
      zoneId: r.zoneId ?? '',
      name: s.name,
      stage: 'APP_PENDING',
    });
  }
  return out;
}

/**
 * Where the on-duty demo partners stand (D154, D199 auto-assign): near their zone's vendors. Tiruppur has Murugan Velu
 * about 1 km and Ravi Shankar about 4 km from Tiruppur Kongu Kitchen, so the auto-assign act picks Murugan first.
 */
const DEMO_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  'Mani Kandan': { lat: 11.0089, lng: 76.953 }, // RS Puram, CBE
  'Arjun Selvam': { lat: 11.0183, lng: 76.966 }, // Gandhipuram, CBE
  'Gokul Krishnan': { lat: 11.079, lng: 76.94 }, // near the CBN vendors
  'Murugan Velu': { lat: 11.1175, lng: 77.3411 }, // ~1 km from Tiruppur Kongu Kitchen
  'Ravi Shankar': { lat: 11.1445, lng: 77.3411 }, // ~4 km from Tiruppur Kongu Kitchen
};

/**
 * Run on every seed: the on-duty demo partners' locations become "now" (lat, lng and time together), so auto-assign
 * sees fresh locations during the demo (the TUP override accepts locations up to 60 minutes old).
 */
export async function refreshPartnerLocations(
  db: PrismaClient,
  log: (l: string) => void,
): Promise<void> {
  const now = new Date();
  let n = 0;
  for (const [name, at] of Object.entries(DEMO_LOCATIONS)) {
    const r = await db.deliveryPartner.updateMany({
      where: { name, deletedAt: null, status: 'ACTIVE', isOnline: true },
      data: { lastLat: at.lat, lastLng: at.lng, lastLocationAt: now },
    });
    n += r.count;
  }
  log(`partner locations refreshed: ${n} on-duty partners (auto-assign needs a fresh location)`);
}
