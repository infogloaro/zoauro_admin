import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

// The demo stack (owner, 2026-10-21: a SEPARATE demo database with sample data; `zoauro` is never touched).
//
//   pnpm --filter @zoauro/api demo:env          writes apps/api/.env.demo from .env (local only, git-ignored)
//   pnpm --filter @zoauro/api demo:db [--reset]  creates (or drops and recreates) zoauro_demo, bucket zoauro-demo,
//                                                grants, migrations, base seed (roles, access profiles, settings)
//   pnpm --filter @zoauro/api demo:api          the API on :4100 against zoauro_demo
//   pnpm --filter @zoauro/api demo:web          the web on 127.0.0.1:3100 against the demo API
//   pnpm --filter @zoauro/api demo:data         the sample data, through the running demo API (scripts/demo/seed.ts)
//
// Safety: every command refuses a database not named exactly zoauro_demo and any host that is not this machine.

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEMO_DB = 'zoauro_demo';
const DEMO_BUCKET = 'zoauro-demo';
const DEMO_API_PORT = 4100;
const DEMO_WEB = 'http://127.0.0.1:3100';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

class DemoError extends Error {}

function readEnvFile(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined)
      out.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

/** The same server and role, the demo database. Refuses anything off this machine. */
function demoUrl(raw: string | undefined, what: string): string {
  if (!raw) throw new DemoError(`${what} is not set in .env`);
  const u = new URL(raw);
  if (!LOOPBACK.has(u.hostname)) throw new DemoError(`refusing: ${what} is not on this machine`);
  u.pathname = `/${DEMO_DB}`;
  return u.toString();
}

function assertDemo(url: string, what: string): URL {
  const u = new URL(url);
  if (!LOOPBACK.has(u.hostname))
    throw new DemoError(`refusing: ${what} host ${u.hostname} is not this machine`);
  if (u.pathname !== `/${DEMO_DB}`)
    throw new DemoError(`refusing: ${what} names ${u.pathname.slice(1)}, not ${DEMO_DB}`);
  return u;
}

const describe = (u: URL) =>
  `${decodeURIComponent(u.username)}@${u.pathname.slice(1)} on ${u.hostname}:${u.port}`;

/** demo:env: .env.demo = .env with the demo database, Redis DB 1, bucket, Mailpit, ports. */
function writeDemoEnv(): void {
  const src = path.join(API_ROOT, '.env');
  if (!existsSync(src)) throw new DemoError('apps/api/.env is missing');
  const env = readEnvFile(src);
  const redis = new URL(env.get('REDIS_URL') ?? 'redis://127.0.0.1:6390');
  if (!LOOPBACK.has(redis.hostname))
    throw new DemoError('refusing: REDIS_URL is not on this machine');
  redis.pathname = '/1';
  const overrides: Record<string, string> = {
    DATABASE_URL: demoUrl(env.get('DATABASE_URL'), 'DATABASE_URL'),
    DATABASE_URL_MIGRATE: demoUrl(env.get('DATABASE_URL_MIGRATE'), 'DATABASE_URL_MIGRATE'),
    ...(env.get('DATABASE_URL_AUDIT_PURGE')
      ? {
          DATABASE_URL_AUDIT_PURGE: demoUrl(
            env.get('DATABASE_URL_AUDIT_PURGE'),
            'DATABASE_URL_AUDIT_PURGE',
          ),
        }
      : {}),
    MFA_ISSUER: 'ZOAURO Demo',
    // the dashboard loads its tiles in parallel; a few more pool connections than the default 10 (lib/db poolOptions)
    DB_POOL_MAX: '15',
    DB_POOL_TIMEOUT_MS: '20000',
    REDIS_URL: redis.toString(),
    S3_BUCKET: DEMO_BUCKET,
    // every demo mail (2-step codes, member emails) lands in Mailpit, never a real mailbox
    SMTP_URL: 'smtp://127.0.0.1:1025',
    SES_FROM_ADDRESS: 'ZOAURO Demo <demo@zoauro.demo>',
    APP_URL: DEMO_WEB,
    PORT: String(DEMO_API_PORT),
  };
  // the real first Super Admin of `zoauro` must not be created in the demo
  const dropped = new Set(['INITIAL_SUPERADMIN_EMAIL', 'INITIAL_SUPERADMIN_PASSWORD']);
  const lines = [
    '# Demo stack (scripts/demo/demo.ts env). Local only, git-ignored. Regenerate, do not edit.',
  ];
  for (const [k, v] of env) {
    if (dropped.has(k) || k in overrides) continue;
    lines.push(`${k}=${v}`);
  }
  for (const [k, v] of Object.entries(overrides)) lines.push(`${k}=${v}`);
  writeFileSync(path.join(API_ROOT, '.env.demo'), `${lines.join('\n')}\n`);
  console.log(
    `wrote apps/api/.env.demo: ${describe(new URL(overrides.DATABASE_URL ?? ''))}, Redis DB 1, bucket ${DEMO_BUCKET}, mail to Mailpit, API :${DEMO_API_PORT}, web ${DEMO_WEB}`,
  );
}

function demoEnv(): Map<string, string> {
  const file = path.join(API_ROOT, '.env.demo');
  if (!existsSync(file)) throw new DemoError('apps/api/.env.demo is missing: run demo:env first');
  return readEnvFile(file);
}

async function ensureBucket(env: Map<string, string>): Promise<void> {
  const endpoint = env.get('S3_ENDPOINT');
  if (!endpoint || !LOOPBACK.has(new URL(endpoint).hostname))
    throw new DemoError('refusing: S3_ENDPOINT is not the local MinIO');
  const s3 = new S3Client({
    endpoint,
    region: env.get('S3_REGION') ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.get('S3_ACCESS_KEY_ID') ?? env.get('AWS_ACCESS_KEY_ID') ?? '',
      secretAccessKey: env.get('S3_SECRET_ACCESS_KEY') ?? env.get('AWS_SECRET_ACCESS_KEY') ?? '',
    },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: DEMO_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: DEMO_BUCKET }));
    console.log(`created bucket ${DEMO_BUCKET}`);
  }
}

/** demo:db [--reset]: the demo database, built by the real migrations and the base seed. */
async function demoDb(reset: boolean): Promise<void> {
  const env = demoEnv();
  const owner = assertDemo(env.get('DATABASE_URL_MIGRATE') ?? '', 'DATABASE_URL_MIGRATE');
  assertDemo(env.get('DATABASE_URL') ?? '', 'DATABASE_URL');
  console.log(`target: ${describe(owner)}`);
  const maint = new URL(owner.toString());
  maint.pathname = '/postgres';
  const admin = new Pool({ connectionString: maint.toString(), max: 1 });
  try {
    const exists =
      (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DEMO_DB])).rowCount === 1;
    if (exists && reset) {
      const live = await admin.query(
        'SELECT usename, count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 GROUP BY usename',
        [DEMO_DB],
      );
      if (live.rowCount)
        throw new DemoError(
          `refusing to reset: ${live.rows.map((r: { usename: string; n: number }) => `${r.n} ${r.usename}`).join(', ')} connection(s) to ${DEMO_DB}; stop the demo API and worker first`,
        );
      await admin.query(`DROP DATABASE ${DEMO_DB}`);
      console.log(`dropped ${DEMO_DB}`);
    }
    if (!exists || reset) {
      await admin.query(`CREATE DATABASE ${DEMO_DB} OWNER zoauro_owner`);
      console.log(`created ${DEMO_DB}`);
      // the grants infra/initdb/01-roles.sql gives `zoauro` (a new database does not inherit them)
      const setup = new Pool({ connectionString: owner.toString(), max: 1 });
      await setup.query('GRANT USAGE ON SCHEMA public TO zoauro_app, zoauro_purge');
      await setup.query(
        'ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zoauro_app',
      );
      await setup.query(
        'ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO zoauro_app',
      );
      await setup.end();
    }
  } finally {
    await admin.end();
  }
  await ensureBucket(env);
  const childEnv = { ...process.env, ...Object.fromEntries(env) };
  delete childEnv['INITIAL_SUPERADMIN_EMAIL'];
  delete childEnv['INITIAL_SUPERADMIN_PASSWORD'];
  // the migrations and base seed of the demo build when there is one, so the schema matches the built code exactly
  const built = path.join(path.resolve(API_ROOT, '../../..'), 'zoauro-demo-build');
  const schemaRoot = existsSync(path.join(built, 'DEMO_BUILD.json'))
    ? path.join(built, 'apps/api')
    : API_ROOT;
  console.log(
    `migrations and base seed from ${schemaRoot === API_ROOT ? 'the working tree (no demo build yet)' : 'the demo build'}`,
  );
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: schemaRoot,
    env: { ...childEnv, DATABASE_URL: owner.toString() },
    stdio: 'inherit',
  });
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  execFileSync(process.execPath, [tsx, 'prisma/seed.ts'], {
    cwd: schemaRoot,
    env: childEnv,
    stdio: 'inherit',
  });
  console.log(`${DEMO_DB} is ready. Next: demo:api (and demo:web), then demo:data.`);
}

// ---- the demo build: committed HEAD only, outside the shared working tree ------------------------------------------

const REPO = path.resolve(API_ROOT, '../..');
/** Beside the repository, never inside it: other sessions' uncommitted work never reaches the demo. */
const BUILD_DIR = path.resolve(REPO, '..', 'zoauro-demo-build');
const PACKAGES = ['packages/shared', 'packages/api-client', 'apps/api', 'apps/web'];
const WORKSPACE: Record<string, string> = {
  '@zoauro/shared': 'packages/shared',
  '@zoauro/api-client': 'packages/api-client',
  '@zoauro/api': 'apps/api',
  '@zoauro/web': 'apps/web',
};

const link = (target: string, at: string) =>
  symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

/** Removes a previous build without ever following a junction into the real node_modules. */
function removeBuild(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) unlinkSync(p);
    else if (st.isDirectory()) removeBuild(p);
    else unlinkSync(p);
  }
  rmdirSync(dir);
}

function run(
  what: string,
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  console.log(`${what} ...`);
  execFileSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
}

/** demo:build [--commit <sha>]: a committed snapshot (default HEAD) exported beside the repo, API bundled with tsup, web built with next build. */
function demoBuild(commit = 'HEAD'): void {
  const head = execFileSync('git', ['rev-parse', '--short', `${commit}^{commit}`], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim();
  console.log(`building the demo from committed HEAD ${head} into ${BUILD_DIR}`);
  removeBuild(BUILD_DIR);
  mkdirSync(BUILD_DIR, { recursive: true });

  // 1. the committed tree, through a throwaway index (never the shared one)
  const tmpIndex = path.join(REPO, '.git', `demo-build-${process.pid}.index`);
  const gitEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    execFileSync('git', ['read-tree', head], { cwd: REPO, env: gitEnv });
    execFileSync(
      'git',
      ['checkout-index', '-a', '-f', `--prefix=${BUILD_DIR.split('\\').join('/')}/`],
      {
        cwd: REPO,
        env: gitEnv,
      },
    );
  } finally {
    rmSync(tmpIndex, { force: true });
  }

  // 2. installed dependencies, with the workspace packages pointing at the export (as scripts/typecheck-commit.mjs)
  link(path.join(REPO, 'node_modules'), path.join(BUILD_DIR, 'node_modules'));
  for (const pkg of PACKAGES) {
    const realNm = path.join(REPO, pkg, 'node_modules');
    if (!existsSync(realNm) || !existsSync(path.join(BUILD_DIR, pkg))) continue;
    const buildNm = path.join(BUILD_DIR, pkg, 'node_modules');
    mkdirSync(buildNm, { recursive: true });
    for (const entry of readdirSync(realNm)) {
      if (entry === '.bin') continue;
      if (entry === '@zoauro') {
        mkdirSync(path.join(buildNm, '@zoauro'), { recursive: true });
        for (const name of readdirSync(path.join(realNm, '@zoauro'))) {
          const own = WORKSPACE[`@zoauro/${name}`];
          link(
            own ? path.join(BUILD_DIR, own) : path.join(realNm, '@zoauro', name),
            path.join(buildNm, '@zoauro', name),
          );
        }
      } else {
        link(path.join(realNm, entry), path.join(buildNm, entry));
      }
    }
  }

  // 3. the API and the worker, bundled as for production (tsup.config.ts)
  const apiDir = path.join(BUILD_DIR, 'apps/api');
  const tsup = createRequire(path.join(apiDir, 'package.json')).resolve('tsup/dist/cli-default.js');
  run('API: tsup', apiDir, [tsup]);

  // 4. the web, built for `next start`, its /api rewrite pointing at the demo API (rewrites are fixed at build time)
  const webDir = path.join(BUILD_DIR, 'apps/web');
  const next = createRequire(path.join(webDir, 'package.json')).resolve('next/dist/bin/next');
  run('web: next build', webDir, [next, 'build', '--webpack'], {
    ...process.env,
    WEB_INTERNAL_API_URL: `http://127.0.0.1:${DEMO_API_PORT}`,
    NEXT_TELEMETRY_DISABLED: '1',
  });
  writeFileSync(
    path.join(BUILD_DIR, 'DEMO_BUILD.json'),
    `${JSON.stringify({ commit: head, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(
    `demo build of ${head} ready. Start: demo:api, demo:web (and demo:data on a fresh database).`,
  );
}

function builtDir(sub: string): string {
  const dir = path.join(BUILD_DIR, sub);
  if (!existsSync(path.join(BUILD_DIR, 'DEMO_BUILD.json')))
    throw new DemoError('no demo build: run demo:build first');
  return dir;
}

function startChild(cwd: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** demo:api / demo:worker: the built server (plain node, as production) on the demo environment. */
function demoServer(entry: 'server' | 'worker'): void {
  demoEnv(); // refuses when .env.demo is missing
  const apiDir = builtDir('apps/api');
  startChild(
    apiDir,
    [`--env-file=${path.join(API_ROOT, '.env.demo')}`, `dist/${entry}.js`],
    process.env,
  );
}

/** demo:web: `next start` of the demo build on 127.0.0.1:3100 (not localhost: its cookies stay apart from dev). */
function demoWeb(): void {
  const webDir = builtDir('apps/web');
  const next = createRequire(path.join(webDir, 'package.json')).resolve('next/dist/bin/next');
  startChild(webDir, [next, 'start', '-p', '3100', '-H', '127.0.0.1'], {
    ...process.env,
    WEB_INTERNAL_API_URL: `http://127.0.0.1:${DEMO_API_PORT}`,
  });
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === 'env') return writeDemoEnv();
  if (command === 'db') return demoDb(rest.includes('--reset'));
  if (command === 'build') {
    const i = rest.indexOf('--commit');
    return demoBuild(i >= 0 ? rest[i + 1] : undefined);
  }
  if (command === 'api') return demoServer('server');
  if (command === 'worker') return demoServer('worker');
  if (command === 'web') return demoWeb();
  throw new DemoError('usage: demo.ts env | db [--reset] | build | api | worker | web');
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(
    err instanceof DemoError
      ? err.message
      : `failed: ${err instanceof Error ? err.message : 'unknown'}`,
  );
  process.exit(1);
});
