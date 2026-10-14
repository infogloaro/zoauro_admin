// Production start smoke test (doc 56 P20): runs the BUILT server (dist/server.js) with plain node, exactly as
// `pnpm --filter @zoauro/api start` does, on a spare port, and checks /api/health and /api/ready. Read-only: it starts
// the server against the database in apps/api/.env and only calls the two probes.
//
//   pnpm --filter @zoauro/api smoke:start        (builds first)
//
// Plain JavaScript on purpose: no tsx loader, so a TypeScript-only import in dist fails here as it would in production.
/* global fetch -- Node 22 has fetch built in */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT ?? 4799);
const base = `http://localhost:${port}`;

await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', () => reject(new Error(`port ${port} is in use; set SMOKE_PORT`)));
  probe.listen(port, () => probe.close(resolve));
});

const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server.js'], {
  cwd: apiDir,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

function stop() {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function get(p) {
  try {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

let exit = 1;
try {
  const until = Date.now() + 60_000;
  let health = null;
  while (Date.now() < until) {
    if (child.exitCode !== null) break;
    health = await get('/api/health');
    if (health) break;
    await sleep(500);
  }
  if (!health) {
    // the server's own messages never carry secrets (class names and roles only), so they are safe to show
    console.error(
      `dist/server.js did not answer on ${base}${child.exitCode !== null ? ` (exited ${child.exitCode})` : ''}`,
    );
    console.error(output.split('\n').slice(-15).join('\n'));
  } else {
    const ready = await get('/api/ready');
    console.log(`GET /api/health -> ${health.status}`);
    console.log(`GET /api/ready  -> ${ready?.status ?? 'no answer'} ${ready?.body ?? ''}`);
    exit = health.status === 200 && ready?.status === 200 ? 0 : 1;
  }
} finally {
  stop();
}
console.log(exit === 0 ? 'smoke: the built server starts and is ready' : 'smoke: FAILED');
process.exit(exit);
