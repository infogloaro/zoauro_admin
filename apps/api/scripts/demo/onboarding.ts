import { runWithAuditContext } from '../../src/lib/audit';
import { RegistrationsDatabase } from '../../src/modules/intake/registrations.repository';
import { RegistrationsService } from '../../src/modules/intake/registrations.service';
import type { DemoClient } from './client';
import { DemoHttpError } from './client';
import type { PrismaClient } from './db';
import type { SeededVendor } from './vendors';

// Step: the D170 onboarding queue. DECIDED follows the verification decision (the live and rejected vendors); the
// pending ones are put in each other stage through the real routes (claim, review, more information), then aged so the
// SLA colours show (<24 h, 24-48 h, >48 h). Two vendor-app sign-ups match no zone: "Needs a zone" (Super Admin only).

type Log = (m: string) => void;
type Module = 'restaurants' | 'homemakers' | 'hotels';
const ENTITY: Record<Module, 'RESTAURANT' | 'HOMEMAKER' | 'HOTEL'> = {
  restaurants: 'RESTAURANT',
  homemakers: 'HOMEMAKER',
  hotels: 'HOTEL',
};

async function tryStep(log: Log, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    log(
      `${what} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''} ${JSON.stringify(e.body).slice(0, 200)}` : e instanceof Error ? e.message.slice(0, 200) : 'error'}`,
    );
  }
}

async function age(db: PrismaClient, module: Module, id: string, hours: number): Promise<void> {
  const at = new Date(Date.now() - hours * 3_600_000);
  const data = { onboardingStageAt: at, createdAt: at };
  if (module === 'restaurants') await db.restaurant.update({ where: { id }, data });
  else if (module === 'homemakers') await db.homemaker.update({ where: { id }, data });
  else await db.hotel.update({ where: { id }, data });
}

export async function seedOnboarding(
  db: PrismaClient,
  c: { sa: DemoClient; karthik: DemoClient; suresh: DemoClient },
  vendors: SeededVendor[],
  vendorAppClientId: string,
  log: Log,
): Promise<void> {
  const byName = (n: string) => vendors.find((v) => v.name === n);
  const plan: {
    module: Module;
    id: string | undefined;
    name: string;
    by: DemoClient;
    stage: 'SUBMITTED' | 'UNDER_REVIEW' | 'MORE_INFO_REQUIRED';
    hours: number;
    message?: string;
  }[] = [
    {
      module: 'restaurants',
      id: byName('Thudiyalur Dosa Corner')?.id,
      name: 'Thudiyalur Dosa Corner',
      by: c.sa,
      stage: 'SUBMITTED',
      hours: 6,
    },
    {
      module: 'homemakers',
      id: byName('Ganga Home Foods')?.id,
      name: 'Ganga Home Foods',
      by: c.sa,
      stage: 'SUBMITTED',
      hours: 30,
    },
    {
      module: 'restaurants',
      id: byName('Kovai Biryani House')?.id,
      name: 'Kovai Biryani House',
      by: c.karthik,
      stage: 'UNDER_REVIEW',
      hours: 60,
    },
    {
      module: 'restaurants',
      id: byName('Arya Bhavan')?.id,
      name: 'Arya Bhavan',
      by: c.suresh,
      stage: 'UNDER_REVIEW',
      hours: 10,
    },
    {
      module: 'homemakers',
      id: byName('Amma Samayal')?.id,
      name: 'Amma Samayal',
      by: c.karthik,
      stage: 'MORE_INFO_REQUIRED',
      hours: 36,
      message:
        'Please upload the FSSAI registration (the photo was cut off) and a clear photo of the kitchen.',
    },
  ];
  const hotel = await db.hotel.findFirst({
    where: { name: 'Kovai Grand Inn', deletedAt: null },
    select: { id: true },
  });
  if (hotel)
    plan.push({
      module: 'hotels',
      id: hotel.id,
      name: 'Kovai Grand Inn',
      by: c.sa,
      stage: 'MORE_INFO_REQUIRED',
      hours: 52,
      message:
        'Send the fire safety NOC and the trade licence; the GST certificate is in another name.',
    });

  for (const p of plan) {
    if (!p.id) continue;
    const id = p.id;
    const row =
      p.module === 'restaurants'
        ? await db.restaurant.findUnique({ where: { id }, select: { onboardingStage: true } })
        : p.module === 'homemakers'
          ? await db.homemaker.findUnique({ where: { id }, select: { onboardingStage: true } })
          : await db.hotel.findUnique({ where: { id }, select: { onboardingStage: true } });
    if (row && row.onboardingStage !== 'SUBMITTED') continue; // done by an earlier run
    await tryStep(log, `onboarding ${p.name}`, async () => {
      if (p.stage !== 'SUBMITTED') {
        // the reviewer claims the record first (D174), then opens the review
        await p.by.post('/claims', { entityType: ENTITY[p.module], entityId: id });
        await p.by.post(`/${p.module}/${id}/onboarding/review`, {});
        if (p.stage === 'MORE_INFO_REQUIRED')
          await p.by.post(`/${p.module}/${id}/onboarding/more-info`, { message: p.message });
      }
      await age(db, p.module, id, p.hours);
      log(`onboarding ${p.name}: ${p.stage}, ${p.hours} h old`);
    });
  }

  // Needs a zone: sign-ups from the vendor app whose pincode no zone covers (doc 45 section 1.2)
  const registrations = new RegistrationsService(new RegistrationsDatabase(db));
  const client = {
    id: vendorAppClientId,
    name: 'Vendor app (demo sandbox)',
    type: 'VENDOR_APP' as const,
    environment: 'SANDBOX' as const,
    scopes: ['vendors:register'],
  };
  const signups = [
    {
      vendorId: 'app-vendor-5501',
      type: 'RESTAURANT' as const,
      name: 'Mettupalayam Biryani Point',
      ownerName: 'S. Abdul Kareem',
      phone: '+919842055501',
      address: {
        line1: '22 Ooty Main Road',
        area: 'Mettupalayam',
        city: 'Mettupalayam',
        pincode: '641301',
        lat: 11.2991,
        lng: 76.9349,
      },
      cuisineTags: ['Biryani'],
      hours: 54,
    },
    {
      vendorId: 'app-vendor-5502',
      type: 'HOMEMAKER' as const,
      name: 'Annur Amma Kitchen',
      ownerName: 'Valli Ramasamy',
      phone: '+919842055502',
      address: {
        line1: '5 Kovai Road',
        area: 'Annur',
        city: 'Annur',
        pincode: '641653',
        lat: 11.2321,
        lng: 77.1065,
      },
      cuisineTags: ['Kongu'],
      hours: 20,
    },
  ];
  for (const s of signups) {
    const { hours, ...input } = s;
    await tryStep(log, `sign-up ${s.name}`, async () => {
      const r = await runWithAuditContext(
        { actor: { type: 'APP_CLIENT', id: client.id, name: client.name, role: null } },
        () => registrations.registerVendor(client, input, new Date()),
      );
      if (r.httpStatus !== 200) {
        await age(db, s.type === 'HOMEMAKER' ? 'homemakers' : 'restaurants', r.ref.id, hours);
        log(`sign-up ${s.name} from the vendor app: ${r.ref.zoneStatus}`);
      }
    });
  }
}
