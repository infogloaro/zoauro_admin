// Cross-module flows end to end (QA pass of 2026-10-18): a throwaway database, the real API, the production build of
// the web app, Mailpit for emailed codes, Playwright driving Chromium. Three personas besides the Super Admin: a Zonal
// Admin of zone A, one of zones A + B, one with no zone; vendors, orders and partners seeded in both zones.
//
//   pnpm e2e:flows            seed, start, test, tear down (a few minutes, most of it `next build`)
//   pnpm e2e:flows --grep X   only the tests whose title matches X
//
// Run from apps/api (the pnpm script does). Never touches `zoauro`: the database is created for this run
// (zoauro_audit_test_<hex>, the guard in tests/audit/support/db.ts) and dropped afterwards. Codes and passwords are never
// printed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  PASSWORD,
  TEST_ENCRYPTION_KEY,
  TEST_OTP_HMAC_KEY,
  createAuthTestEnv,
} from '../../../apps/api/tests/auth/support/auth-env';
import { seedOrder, seedPartner } from '../../../apps/api/tests/orders/support';
import { uuidv7 } from '../../../apps/api/tests/audit/support/db';

// own ports (auth uses 4721/3721): two harnesses may run on one machine, one after the other
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 4731);
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3731);
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const MAILPIT = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025';
const SMTP = process.env['E2E_SMTP_URL'] ?? 'smtp://localhost:1025';

const apiDir = process.cwd();
const root = path.resolve(apiDir, '../..');
if (!existsSync(path.join(root, 'pnpm-workspace.yaml')))
  throw new Error('run this from apps/api (use pnpm e2e:flows)');
const stateDir = path.join(root, 'tests/e2e/.state');
const stateFile = path.join(stateDir, 'flows.json');
const grep = process.argv.includes('--grep')
  ? process.argv[process.argv.indexOf('--grep') + 1]
  : undefined;

process.loadEnvFile(path.join(apiDir, '.env'));
delete process.env['NODE_ENV'];
delete process.env['ENCRYPTION_KEY_PREVIOUS'];

const children: ChildProcess[] = [];
function killAll(): void {
  for (const c of children) {
    if (c.pid === undefined || c.exitCode !== null) continue;
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () =>
      reject(new Error(`port ${port} is in use; set E2E_WEB_PORT / E2E_API_PORT`)),
    );
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

async function waitFor(url: string, what: string, ms = 120_000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > until)
      throw new Error(`${what} did not come up at ${url} within ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function start(name: string, args: string[], cwd: string, env: Record<string, string>): void {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
}

async function main(): Promise<number> {
  const mailpit = await fetch(`${MAILPIT}/api/v1/messages?limit=1`).catch(() => null);
  if (!mailpit?.ok) throw new Error(`Mailpit is not reachable at ${MAILPIT} (pnpm infra:up)`);

  console.log('creating a throwaway database …');
  const env = await createAuthTestEnv();
  let exit = 1;
  try {
    const q = env.db.owner.query.bind(env.db.owner);
    const zoneA = await env.createZone();
    const zoneB = await env.createZone();
    const zoneRow = async (id: string) =>
      (await q(`SELECT id, name, code FROM zones WHERE id = $1`, [id])).rows[0] as {
        id: string;
        name: string;
        code: string;
      };

    const superAdmin = await env.createUser('SUPER_ADMIN', { emailPrefix: 'flow-sa' });
    const zaA = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'flow-za-a' });
    const zaAB = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'flow-za-ab' });
    const zaNone = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'flow-za-none' });

    // an operations profile: vendors, orders and delivery in full, reveal allowed (D123)
    const all = ['view', 'add', 'edit', 'delete', 'status'];
    const profile = await env.createProfile(
      {
        dashboard: ['view'],
        restaurants: all,
        homemakers: all,
        orders: all,
        delivery: all,
        customers: ['view'],
      },
      { canReveal: true },
    );
    await q(`UPDATE access_profiles SET name = 'E2E Flow operations' WHERE id = $1`, [profile]);
    await env.assignZone(zaA.id, zoneA, superAdmin.id, { profileId: profile });
    await env.assignZone(zaAB.id, zoneA, superAdmin.id, { profileId: profile });
    await env.assignZone(zaAB.id, zoneB, superAdmin.id, { profileId: profile });

    // vendors: one to onboard in A (masked contacts), a Home Food provider in A, an active restaurant in B
    const onboard = uuidv7();
    await q(
      `INSERT INTO restaurants (id, zone_id, name, owner_name, phone, email, area, cuisine_tags, source, updated_at)
       VALUES ($1, $2, 'Flow Kitchen Adyar', 'Meena Raman', '+919876543210', 'meena.owner@example.test', 'Adyar',
         ARRAY['South Indian'], 'ADMIN', now())`,
      [onboard, zoneA],
    );
    const homeFood = uuidv7();
    await q(
      `INSERT INTO homemakers (id, zone_id, name, phone, area, speciality_tags, source, updated_at)
       VALUES ($1, $2, 'Amma Home Food', '+919812345678', 'Besant Nagar', ARRAY['Meals'], 'ADMIN', now())`,
      [homeFood, zoneA],
    );
    const restaurantB = uuidv7();
    await q(
      `INSERT INTO restaurants (id, zone_id, name, phone, area, cuisine_tags, status, verification_status, source, updated_at)
       VALUES ($1, $2, 'Zone B Biryani', '+919800000001', 'Velachery', ARRAY['Biryani'], 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
      [restaurantB, zoneB],
    );

    // partners: one in A (verified, online, free), one in B (must never be offered for a zone-A order)
    const riderA = await seedPartner(env, zoneA, { name: 'Ravi Rider' });
    const riderB = await seedPartner(env, zoneB, { name: 'Bala Rider' });

    // orders in A: one to walk through the states, one READY (second assignment), one to cancel; one in B
    const walk = await seedOrder(env, zoneA, { customerName: 'Walk Customer' });
    const ready = await seedOrder(env, zoneA, { status: 'READY', customerName: 'Ready Customer' });
    const cancel = await seedOrder(env, zoneA, { customerName: 'Cancel Customer' });
    const orderB = await seedOrder(env, zoneB, { customerName: 'Zone B Customer' });

    mkdirSync(stateDir, { recursive: true });
    const user = (u: { email: string; totpSecret?: string }) => ({
      email: u.email,
      ...(u.totpSecret ? { totpSecret: u.totpSecret } : {}),
    });
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          password: PASSWORD,
          mailpit: MAILPIT,
          superAdmin: user(superAdmin),
          zaA: user(zaA),
          zaAB: user(zaAB),
          zaNone: user(zaNone),
          zoneA: await zoneRow(zoneA),
          zoneB: await zoneRow(zoneB),
          profileName: 'E2E Flow operations',
          vendors: { onboard, homeFood, restaurantB },
          partners: { riderA, riderB },
          orders: {
            walk: { id: walk.orderId, no: walk.orderNo },
            ready: { id: ready.orderId, no: ready.orderNo },
            cancel: { id: cancel.orderId, no: cancel.orderNo },
            zoneB: { id: orderB.orderId, no: orderB.orderNo },
          },
        },
        null,
        2,
      ),
    );

    const stackEnv = {
      DATABASE_URL: env.db.appUrl,
      PORT: String(API_PORT),
      APP_URL: WEB,
      WEB_INTERNAL_API_URL: API,
    };
    await assertPortFree(API_PORT);
    await assertPortFree(WEB_PORT);

    console.log('building the web app …');
    const nextCli = path.join(root, 'apps/web/node_modules/next/dist/bin/next');
    const build = spawnSync(process.execPath, [nextCli, 'build'], {
      cwd: path.join(root, 'apps/web'),
      env: { ...process.env, ...stackEnv },
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error('next build failed');

    start('api', ['--import', 'tsx', 'src/server.ts'], apiDir, {
      ...stackEnv,
      NODE_ENV: 'development',
      SMTP_URL: SMTP,
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      OTP_HMAC_KEY: TEST_OTP_HMAC_KEY,
      // document uploads go to the local MinIO; the S3 client takes the SDK's default chain, which apps/api/.env does
      // not fill yet (handoff open point). The dev-only MinIO login of docker-compose.dev.yml, unless the shell has one.
      AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'] ?? 'zoauro_minio',
      AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'zoauro_minio_dev',
    });
    await waitFor(`${API}/api/ready`, 'the API');
    start('web', [nextCli, 'start', '-p', String(WEB_PORT)], path.join(root, 'apps/web'), stackEnv);
    await waitFor(`${WEB}/login`, 'the web app');

    const chromium = path.join(
      process.env['LOCALAPPDATA'] ?? '',
      'ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '-c',
        path.join(root, 'tests/e2e/flows/playwright.config.ts'),
        ...(grep ? ['--grep', grep] : []),
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          E2E_STATE: stateFile,
          E2E_BASE_URL: WEB,
          ...(process.env['PLAYWRIGHT_CHROMIUM_PATH'] || !existsSync(chromium)
            ? {}
            : { PLAYWRIGHT_CHROMIUM_PATH: chromium }),
        },
      },
    );
    exit = result.status ?? 1;
  } finally {
    killAll();
    rmSync(stateFile, { force: true });
    rmSync(path.join(stateDir, 'flows-totp.json'), { force: true });
    await env.close();
  }
  return exit;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    killAll();
    process.exit(1);
  },
);
