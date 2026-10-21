#!/usr/bin/env node
// Pre-commit check of the commit itself, not of the shared working tree.
// Several sessions share one checkout, so the working tree always holds other
// people's unfinished edits. This script writes the index being committed
// (GIT_INDEX_FILE is honoured) to a snapshot folder, links the installed
// dependencies into it, points the workspace packages (@zoauro/*) at the
// snapshot's own copies, then checks formatting and lint of the changed files
// and runs tsc for every workspace package there. It never edits or re-stages
// files: re-adding working-tree copies (as lint-staged does) swept other
// sessions' hunks into commits.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const PACKAGES = ['packages/shared', 'packages/api-client', 'apps/api', 'apps/web'];
const WORKSPACE = {
  '@zoauro/shared': 'packages/shared',
  '@zoauro/api-client': 'packages/api-client',
};

const tree = execFileSync('git', ['write-tree'], { cwd: root, encoding: 'utf8' }).trim();
const changed = execFileSync(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);
const LINTED = /\.(ts|tsx|mjs|js)$/;
const FORMATTED = /\.(ts|tsx|mjs|js|json|md|yml|yaml|css)$/;
const snap = join(root, '.git', 'zo-snap', randomUUID());
mkdirSync(snap, { recursive: true });

const link = (target, path) =>
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');

let failed = false;
try {
  // 1. The committed tree, exactly as it will land (a throwaway index, never the shared one).
  const tmpIndex = `${snap}.index`;
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  execFileSync('git', ['read-tree', tree], { cwd: root, env });
  execFileSync('git', ['checkout-index', '-a', '-f', `--prefix=${snap.split('\\').join('/')}/`], {
    cwd: root,
    env,
  });
  rmSync(tmpIndex, { force: true });

  // 2. Installed dependencies, with workspace packages redirected to the snapshot.
  link(join(root, 'node_modules'), join(snap, 'node_modules'));
  for (const pkg of PACKAGES) {
    const realNm = join(root, pkg, 'node_modules');
    if (!existsSync(realNm) || !existsSync(join(snap, pkg))) continue;
    const snapNm = join(snap, pkg, 'node_modules');
    mkdirSync(snapNm, { recursive: true });
    for (const entry of readdirSync(realNm)) {
      if (entry === '@zoauro') {
        mkdirSync(join(snapNm, '@zoauro'), { recursive: true });
        for (const name of readdirSync(join(realNm, '@zoauro'))) {
          const own = WORKSPACE[`@zoauro/${name}`];
          link(
            own ? join(snap, own) : join(realNm, '@zoauro', name),
            join(snapNm, '@zoauro', name),
          );
        }
      } else {
        link(join(realNm, entry), join(snapNm, entry));
      }
    }
  }

  // 3. Formatting and lint of the committed versions of the changed files (read-only).
  const tool = (bin, args, label) => {
    if (args.length === 0) return;
    const run = spawnSync(process.execPath, [resolve(root, 'node_modules', ...bin), ...args], {
      cwd: snap,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    if (run.status === 0) {
      console.log(`${label} (commit snapshot): Done`);
    } else {
      failed = true;
      console.error(
        `${label} (commit snapshot): Failed. Fix the files (e.g. pnpm exec prettier --write / eslint --fix), re-stage them and commit again.`,
      );
      console.error((run.stdout + run.stderr).split(snap).join('.'));
    }
  };
  const inSnap = (files) => files.filter((file) => existsSync(join(snap, file)));
  tool(
    ['prettier', 'bin', 'prettier.cjs'],
    ['--check', '--ignore-unknown', ...inSnap(changed.filter((f) => FORMATTED.test(f)))],
    'prettier',
  );
  tool(
    ['eslint', 'bin', 'eslint.js'],
    ['--no-warn-ignored', '--max-warnings', '0', ...inSnap(changed.filter((f) => LINTED.test(f)))],
    'eslint',
  );

  // 4. tsc per package inside the snapshot, two at a time (like `pnpm -r typecheck`).
  const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const check = (pkg) =>
    new Promise((done) => {
      const child = spawn(
        process.execPath,
        [tsc, '--noEmit', '-p', join(snap, pkg, 'tsconfig.json')],
        {
          cwd: join(snap, pkg),
        },
      );
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`${pkg} typecheck (commit snapshot): Done`);
        } else {
          failed = true;
          console.error(`${pkg} typecheck (commit snapshot): Failed`);
          console.error(out.split(snap).join('.'));
        }
        done();
      });
    });
  // Only the packages the commit can affect: shared feeds everything, api-client
  // feeds web, tests/e2e is part of the api project, root config affects all.
  const affected = new Set();
  for (const file of changed) {
    if (file.startsWith('packages/shared/')) PACKAGES.forEach((pkg) => affected.add(pkg));
    else if (file.startsWith('packages/api-client/'))
      ['packages/api-client', 'apps/web'].forEach((p) => affected.add(p));
    else if (file.startsWith('apps/api/') || file.startsWith('tests/e2e/'))
      affected.add('apps/api');
    else if (file.startsWith('apps/web/')) affected.add('apps/web');
    else if (!file.includes('/') && /\.(json|ya?ml|mjs|cjs|js|ts)$/.test(file))
      PACKAGES.forEach((pkg) => affected.add(pkg));
  }
  const queue = PACKAGES.filter(
    (pkg) => affected.has(pkg) && existsSync(join(snap, pkg, 'tsconfig.json')),
  );
  if (queue.length === 0)
    console.log('typecheck (commit snapshot): no TypeScript package affected');
  await Promise.all(
    [0, 1].map(async () => {
      for (let pkg = queue.shift(); pkg; pkg = queue.shift()) await check(pkg);
    }),
  );
} finally {
  // Junctions first, so removing the snapshot never follows them into the real tree.
  const unlinkLinks = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) rmSync(path, { force: true });
      else if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name === '@zoauro'))
        unlinkLinks(path);
    }
  };
  unlinkLinks(snap);
  for (const pkg of PACKAGES) unlinkLinks(join(snap, pkg));
  rmSync(snap, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
