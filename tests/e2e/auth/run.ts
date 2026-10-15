// Sign-in screens end to end (P15, doc 52 TC-AUTH-45/46/47): a throwaway database, the real API, the production build of
// the web app, Mailpit for the emailed codes, and Playwright driving a real Chromium.
//
//   pnpm e2e:auth            create users, start, test, tear down (about 3 minutes, most of it `next build`)
//
// Run from apps/api (the pnpm script does): the packages this needs (pg, ioredis, prisma, tsx) live there. Never touches
// `zoauro`: the database is created for this run and dropped afterwards. Codes and passwords are never printed.
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

// uncommon ports on purpose (as e2e:system-logs): a developer machine often has other projects on 3000/4000
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 4721);
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3721);
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const MAILPIT = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025';
// always Mailpit, whatever SMTP_URL apps/api/.env holds: the run's addresses are fake and its codes are read from Mailpit
const SMTP = process.env['E2E_SMTP_URL'] ?? 'smtp://localhost:1025';

const apiDir = process.cwd();
const root = path.resolve(apiDir, '../..');
if (!existsSync(path.join(root, 'pnpm-workspace.yaml')))
  throw new Error('run this from apps/api (use pnpm e2e:auth)');
const stateDir = path.join(root, 'tests/e2e/.state');
const stateFile = path.join(stateDir, 'auth.json');
const grep = process.argv.includes('--grep')
  ? process.argv[process.argv.indexOf('--grep') + 1]
  : undefined;

process.loadEnvFile(path.join(apiDir, '.env'));
// the API's .env says NODE_ENV=development; it is passed to the API alone, because next build must not see it
delete process.env['NODE_ENV'];
// a previous key from the local .env cannot open secrets sealed with the test key below; it must not be passed on
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
    const zone = await env.createZone();
    // enrolled through the screens (no method yet)
    const superNew = await env.createUser('SUPER_ADMIN', { mfa: false, emailPrefix: 'e2e-sa-new' });
    const zonalNew = await env.createUser('ZONAL_ADMIN', { mfa: false, emailPrefix: 'e2e-za-new' });
    // already enrolled with an authenticator (secret sealed with the test key the API runs with below)
    const superAdmin = await env.createUser('SUPER_ADMIN', { emailPrefix: 'e2e-sa' });
    const zonalAdmin = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'e2e-za' });
    const locked = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'e2e-lock' });
    const resetter = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'e2e-reset' });
    const firstLogin = await env.createUser('SUPER_ADMIN', {
      emailPrefix: 'e2e-first',
      mustChangePassword: true,
    });
    for (const u of [zonalNew, zonalAdmin, locked, resetter])
      await env.assignZone(u.id, zone, superAdmin.id);

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
          superNew: user(superNew),
          zonalNew: user(zonalNew),
          superAdmin: user(superAdmin),
          zonalAdmin: user(zonalAdmin),
          locked: user(locked),
          resetter: user(resetter),
          firstLogin: user(firstLogin),
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

    // the committed test keys (not secrets): the pre-enrolled users' authenticator secrets are sealed with them
    start('api', ['--import', 'tsx', 'src/server.ts'], apiDir, {
      ...stackEnv,
      NODE_ENV: 'development',
      SMTP_URL: SMTP,
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      OTP_HMAC_KEY: TEST_OTP_HMAC_KEY,
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
        path.join(root, 'tests/e2e/auth/playwright.config.ts'),
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
