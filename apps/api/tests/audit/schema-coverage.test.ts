import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUncoveredSecretLikeColumns } from '../../src/lib/audit';

// TC-AUD-6 against the REAL schema: every column whose name looks sensitive must be dropped, masked or allow-listed
// in lib/audit/registry.ts. If this fails, do not add the column to KEEP_ALLOWLIST to make it pass: decide per column
// (drop it from audit JSON, mask it, or allow-list it with a reason) and record the decision.
describe('TC-AUD-6 redaction registry covers the real prisma/schema.prisma', () => {
  it('has no uncovered secret-like column', () => {
    const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
    expect(findUncoveredSecretLikeColumns(schema)).toEqual([]);
  });
});
