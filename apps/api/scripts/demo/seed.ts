import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPrismaClient } from '../../src/lib/db';
import { newTotpSecret } from '../../src/modules/auth/mfa/totp';
import type { DemoAccount } from './client';
import { DemoHttpError } from './client';
import { ACCOUNTS, seedPeople, type AccountKey } from './people';
import { seedVendors } from './vendors';
import { ensureAppClients, seedMenu } from './menu';
import { seedPartners } from './partners';
import { seedCustomers } from './customers';
import { seedOrders } from './orders';
import { seedSettings } from './settings';
import { seedHotels, seedNotifications, seedSupport } from './extras';
import { seedRefunds } from './refunds';
import { seedOnboarding } from './onboarding';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';

// `pnpm --filter @zoauro/api demo:data` (env from .env.demo): sample data for the demo, through the RUNNING demo API
// (`demo:api`) as the demo accounts, so every record has its real audit trail; direct rows only where no admin route
// exists. Re-runnable: each step skips what is already there. Start over with demo:reset + demo:data.
//
// Credentials: generated once into DEMO_CREDENTIALS (default: apps/api/.env.demo-credentials.json, git-ignored by
// `.env.*`) and reused, so re-seeding keeps every login.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function demoTarget(): { ownerUrl: string; apiBase: string; origin: string } {
  const owner = process.env['DATABASE_URL_MIGRATE'] ?? '';
  const app = process.env['DATABASE_URL'] ?? '';
  for (const [what, raw] of [
    ['DATABASE_URL_MIGRATE', owner],
    ['DATABASE_URL', app],
  ] as const) {
    if (!raw) throw new Error(`${what} is not set: run with --env-file=.env.demo (pnpm demo:data)`);
    const u = new URL(raw);
    if (!LOOPBACK.has(u.hostname)) throw new Error(`refusing: ${what} is not on this machine`);
    if (u.pathname !== '/zoauro_demo')
      throw new Error(`refusing: ${what} names ${u.pathname.slice(1)}, not zoauro_demo`);
  }
  const port = process.env['PORT'] ?? '4100';
  if (port === '4000')
    throw new Error('refusing: PORT 4000 is the development API, not the demo one');
  const origin = new URL(process.env['APP_URL'] ?? 'http://127.0.0.1:3100').origin;
  return { ownerUrl: owner, apiBase: `http://127.0.0.1:${port}/api/v1`, origin };
}

/** Stable demo logins: created once, then read back, so a reset + re-seed keeps the same passwords. */
function loadAccounts(file: string): {
  accounts: Record<AccountKey, DemoAccount>;
  created: boolean;
} {
  const stored: Partial<Record<AccountKey, { password: string; totpSecret: string }>> = existsSync(
    file,
  )
    ? (JSON.parse(readFileSync(file, 'utf8')) as { accounts: Record<AccountKey, DemoAccount> })
        .accounts
    : {};
  let created = false;
  const accounts = {} as Record<AccountKey, DemoAccount>;
  for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
    const s = stored[key];
    if (!s) created = true;
    accounts[key] = {
      ...ACCOUNTS[key],
      // 20 URL-safe characters (120 bits) with a digit and a symbol, so every password policy accepts it
      password: s?.password ?? `Zo${randomBytes(12).toString('base64url')}#9`,
      totpSecret: s?.totpSecret ?? newTotpSecret(),
    };
  }
  if (created) {
    writeFileSync(
      file,
      `${JSON.stringify({ note: 'ZOAURO demo logins (zoauro_demo only). Local file: never commit or share.', accounts }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
  return { accounts, created };
}

async function main(): Promise<void> {
  const target = demoTarget();
  const credFile =
    process.env['DEMO_CREDENTIALS'] ?? path.resolve(process.cwd(), '.env.demo-credentials.json');
  const { accounts, created } = loadAccounts(credFile);
  const log = (m: string) => console.log(`  ${m}`);
  const encryption = {
    current: process.env['ENCRYPTION_KEY'] ?? '',
    ...(process.env['ENCRYPTION_KEY_PREVIOUS']
      ? { previous: process.env['ENCRYPTION_KEY_PREVIOUS'] }
      : {}),
  };
  if (!encryption.current) throw new Error('ENCRYPTION_KEY is not set (.env.demo)');

  // /api/health (process up), with retries: /api/ready's 2 s checks time out when the machine is short of memory
  let up = false;
  for (let i = 0; i < 10 && !up; i++) {
    const r = await fetch(`${target.apiBase.replace('/api/v1', '')}/api/health`).catch(() => null);
    up = r?.ok === true;
    if (!up) await new Promise((res) => setTimeout(res, 2000));
  }
  if (!up)
    throw new Error(
      `the demo API is not running on ${target.apiBase}: start it with demo:api first`,
    );

  const db = createPrismaClient(target.ownerUrl);
  try {
    console.log('1 people: zones, access profiles, Super Admins, Zonal Admins, zone teams');
    const people = await seedPeople(
      db,
      accounts,
      { base: target.apiBase, origin: target.origin },
      encryption,
      log,
    );
    const sa = people.clients.primary;
    console.log('2 vendors: restaurants, shops and home food at every stage, with documents');
    const vendors = await seedVendors(db, sa, people.zoneId, log);
    console.log('3 menu: categories, items, food item requests from the vendor app');
    const secretBox = createSecretBox(encryption);
    const appClients = await ensureAppClients(db, secretBox);
    const items = await seedMenu(db, sa, vendors, appClients['VENDOR_APP'] ?? '', log);
    console.log('4 delivery partners: every stage, plus Partner Requests from the partner app');
    const partners = await seedPartners(
      db,
      sa,
      people.zoneId,
      appClients['PARTNER_APP'] ?? '',
      log,
    );
    console.log(
      '5 Control Panel settings: reward points, orders per partner, refund caps, commission switch',
    );
    await seedSettings(sa, people.zoneId, log);
    console.log('6 customers: addresses, blocked customers, reward points');
    const customers = await seedCustomers(db, sa, people.zoneId, log);
    console.log("7 orders: 30 days of history, today's live board in every status, pre-orders");
    const z = people.zoneId;
    await seedOrders(
      db,
      {
        sa,
        byZone: {
          CBE: people.clients.karthik,
          CBN: people.clients.karthik,
          TUP: people.clients.suresh,
        },
      },
      {
        vendors,
        items,
        partners,
        customers,
        adminByZone: {
          [z['CBE'] ?? '']: people.userId.karthik,
          [z['CBN'] ?? '']: people.userId.karthik,
          [z['TUP'] ?? '']: people.userId.suresh,
        },
      },
      log,
    );
    console.log('8 hotels: room bookings and table bookings');
    await seedHotels(db, sa, people.zoneId, customers, vendors, log);
    console.log('9 support desk: tickets in every status');
    await seedSupport(
      db,
      sa,
      people.clients.karthik,
      customers,
      {
        // only members holding support:edit in the zone can take its tickets: the zone lead
        superAdmin: people.userId.karthik,
        zonal: people.userId.karthik,
      },
      log,
    );
    console.log('10 notifications: message, promotion pending approval, scheduled promotion');
    await seedNotifications(db, sa, people.clients.karthik, people.zoneId, log);
    console.log(
      '11 onboarding queue: submitted, under review (claimed), more information, needs a zone',
    );
    await seedOnboarding(
      db,
      { sa, karthik: people.clients.karthik, suresh: people.clients.suresh },
      vendors,
      appClients['VENDOR_APP'] ?? '',
      log,
    );
    console.log('12 refunds: requested, pending approval, approved, processed, rejected');
    await seedRefunds(
      db,
      { sa, zonal: people.clients.karthik },
      people.zoneId['CBE'] ?? '',
      appClients['CUSTOMER_APP'] ?? '',
      log,
    );
  } finally {
    await db.$disconnect();
  }

  console.log(
    '\nDemo accounts (2-step: email code from Mailpit http://127.0.0.1:8025, or the authenticator secret):',
  );
  for (const a of Object.values(accounts))
    console.log(`  ${a.role.padEnd(11)} ${a.email.padEnd(28)} ${a.name}`);
  console.log(`Passwords and authenticator secrets: ${credFile}${created ? ' (new)' : ''}`);
  console.log(`Open ${target.origin} (run demo:web).`);
}

main().catch((err: unknown) => {
  console.error(
    err instanceof DemoHttpError
      ? err.message
      : err instanceof Error
        ? (err.stack ?? err.message)
        : err,
  );
  process.exit(1);
});
