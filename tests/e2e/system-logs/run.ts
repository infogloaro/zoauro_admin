// System Logs end-to-end run (AU-6): a throwaway database with 2,000,000 audit rows, the real API, the production build of
// the web app, and Playwright driving a real Chromium.
//
//   pnpm e2e:system-logs            seed, start, test, tear down (about 10 minutes, almost all of it seeding)
//   pnpm e2e:system-logs --keep     leave the database behind and print how to reuse it
//   pnpm e2e:system-logs --reuse    reuse the database kept by --keep (no seeding: about 2 minutes)
//
// Run from apps/api (the pnpm script does): the packages this needs (pg, ioredis, prisma, tsx) live there.
// audit_logs is append-only, so the database is always a throwaway one, never `zoauro`.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { seedAuditRows, perfZone } from '../../../apps/api/scripts/seed-audit';
import { PASSWORD, createAuthTestEnv } from '../../../apps/api/tests/auth/support/auth-env';

// uncommon ports on purpose: a developer machine often has other projects on 3000/3100/4000/4100
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 4720);
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3720);
const WEB = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const ROWS = Number(process.env['E2E_ROWS'] ?? 2_000_000);

const apiDir = process.cwd();
const root = path.resolve(apiDir, '../..');
if (!existsSync(path.join(root, 'pnpm-workspace.yaml')))
  throw new Error('run this from apps/api (use pnpm e2e:system-logs)');
const stateDir = path.join(root, 'tests/e2e/.state');
const stateFile = path.join(stateDir, 'system-logs.json');
const keep = process.argv.includes('--keep');
// --serve: bring the stack up on the kept database and wait (to poke it with curl or a browser); stop with Ctrl-C
const serve = process.argv.includes('--serve');
const reuse = process.argv.includes('--reuse') || serve;

process.loadEnvFile(path.join(apiDir, '.env'));
const grep = process.argv.includes('--grep')
  ? process.argv[process.argv.indexOf('--grep') + 1]
  : undefined;
// the API's .env says NODE_ENV=development; it is passed to the API alone, because next build must not see a non-standard value
delete process.env['NODE_ENV'];

interface State {
  appUrl: string;
  ownerUrl: string;
  password: string;
  superAdmin: { email: string };
  zonalAdmin: { email: string };
  rows: number;
}

const children: ChildProcess[] = [];
function killAll(): void {
  for (const c of children) {
    if (c.pid === undefined || c.exitCode !== null) continue;
    // on Windows kill() leaves grandchildren behind: take the whole tree
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}

/** Another process on the port would answer our requests instead of the stack under test: refuse to start. */
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () =>
      reject(
        new Error(
          `port ${port} is already in use by another process; set E2E_WEB_PORT / E2E_API_PORT`,
        ),
      ),
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

function start(
  name: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}

async function main(): Promise<number> {
  let state: State;
  let closeDb: () => Promise<void> = async () => undefined;

  if (reuse) {
    if (!existsSync(stateFile))
      throw new Error(`--reuse needs ${stateFile} (run once with --keep)`);
    state = JSON.parse(readFileSync(stateFile, 'utf8')) as State;
    console.log(`reusing the kept database (${state.rows.toLocaleString('en-IN')} rows)`);
  } else {
    console.log('creating a throwaway database …');
    const env = await createAuthTestEnv();
    closeDb = keep ? async () => undefined : () => env.close();
    const owner = env.db.owner;

    // zones and the 50 admins the seeded rows were "made by" (ids and names match scripts/seed-audit.ts)
    await owner.query(`INSERT INTO zones (id, name, code, city, updated_at)
      SELECT ('0192f1d2-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Zone ' || lpad(n::text, 2, '0'), 'Z' || lpad(n::text, 2, '0'), 'Chennai', now()
      FROM generate_series(1, 30) n`);
    const role = await owner.query(`SELECT id FROM roles WHERE name = 'ZONAL_ADMIN'`);
    await owner.query(
      `INSERT INTO users (id, name, email, password_hash, role_id, status, mfa_enabled, must_change_password, updated_at)
       SELECT ('0192f1d2-1111-7000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Member ' || n, 'member' || n || '@e2e.test', 'not-a-login', $1, 'ACTIVE', false, false, now()
       FROM generate_series(1, 50) n`,
      [role.rows[0].id],
    );
    const superAdmin = await env.createUser('SUPER_ADMIN', { emailPrefix: 'e2e-sa' });
    const zonalAdmin = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'e2e-za' });
    await env.assignZone(zonalAdmin.id, perfZone(0), superAdmin.id);

    const t = Date.now();
    console.log(`seeding ${ROWS.toLocaleString('en-IN')} audit rows (a few minutes) …`);
    await seedAuditRows(owner, ROWS);
    console.log(`seeded in ${Math.round((Date.now() - t) / 1000)} s`);

    state = {
      appUrl: env.db.appUrl,
      ownerUrl: env.db.ownerUrl,
      password: PASSWORD,
      superAdmin: { email: superAdmin.email },
      zonalAdmin: { email: zonalAdmin.email },
      rows: ROWS,
    };
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  const stackEnv = {
    DATABASE_URL: state.appUrl,
    PORT: String(API_PORT),
    APP_URL: WEB,
    WEB_INTERNAL_API_URL: API,
  };

  await assertPortFree(API_PORT);
  await assertPortFree(WEB_PORT);

  let exit = 1;
  try {
    console.log('building the web app …');
    rmSync(path.join(root, 'apps/api/test-reports/system-logs-e2e.jsonl'), { force: true });
    const nextCli = path.join(root, 'apps/web/node_modules/next/dist/bin/next');
    const build = spawnSync(process.execPath, [nextCli, 'build'], {
      cwd: path.join(root, 'apps/web'),
      env: { ...process.env, ...stackEnv },
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error('next build failed');

    // NODE_ENV only for the API (development: no production-only environment rules); `next build` must not see it
    start('api', process.execPath, ['--import', 'tsx', 'src/server.ts'], apiDir, {
      ...stackEnv,
      NODE_ENV: 'development',
    });
    await waitFor(`${API}/api/ready`, 'the API');
    start(
      'web',
      process.execPath,
      [nextCli, 'start', '-p', String(WEB_PORT)],
      path.join(root, 'apps/web'),
      stackEnv,
    );
    await waitFor(`${WEB}/`, 'the web app');

    if (serve) {
      console.log(`
stack is up: web ${WEB}  api ${API}  (Ctrl-C to stop)`);
      await new Promise<never>(() => setInterval(() => undefined, 1 << 30));
    }

    const chromium = path.join(
      process.env['LOCALAPPDATA'] ?? '',
      'ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    );
    const playwrightCli = path.join(root, 'node_modules/@playwright/test/cli.js');
    const result = spawnSync(
      process.execPath,
      [
        playwrightCli,
        'test',
        '-c',
        path.join(root, 'tests/e2e/system-logs/playwright.config.ts'),
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
    if (keep) {
      console.log(
        `\nkept the database. Reuse it with: pnpm e2e:system-logs --reuse   (state: ${stateFile})`,
      );
    } else if (!reuse) {
      await closeDb();
    }
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
