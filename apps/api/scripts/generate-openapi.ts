// Writes the OpenAPI document and the typed client schema, or with --check verifies the committed copies are current.
//   pnpm openapi:generate     regenerate apps/api/openapi/openapi.json and packages/api-client/src/schema.ts
//   pnpm openapi:check        exit 1 if either committed file differs from what the code generates (used by CI)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGeneratedFiles } from '../src/openapi/files';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const check = process.argv.includes('--check');

const files = await buildGeneratedFiles();
let stale = 0;
for (const [relative, content] of Object.entries(files)) {
  const target = resolve(root, relative);
  if (check) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      /* missing counts as different */
    }
    if (current !== content) {
      stale += 1;
      console.error(`OUT OF DATE: ${relative}`);
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`wrote ${relative}`);
  }
}
if (check) {
  if (stale > 0) {
    console.error(
      'The committed API contract differs from the code. Run `pnpm openapi:generate` and commit the result.',
    );
    process.exit(1);
  }
  console.log('OpenAPI document and client schema are up to date.');
}
