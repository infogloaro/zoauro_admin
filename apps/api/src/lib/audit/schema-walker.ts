import { classifyField, KEEP_ALLOWLIST, SECRET_LIKE } from './registry';

/**
 * Finds Prisma model columns whose names look sensitive but are not covered by the redaction registry
 * (neither dropped, masked, nor explicitly allow-listed). Used by a test that fails CI (doc 50 §5.5, TC-AUD-6).
 */
export function findUncoveredSecretLikeColumns(prismaSchemaText: string): string[] {
  const problems: string[] = [];
  // relation fields (a field typed as another model) are not columns: User.passwordResetTokens is a list of PasswordResetToken
  const modelNames = new Set(
    [...prismaSchemaText.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1] ?? ''),
  );
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (let m = modelRe.exec(prismaSchemaText); m; m = modelRe.exec(prismaSchemaText)) {
    const model = m[1] ?? '';
    for (const line of (m[2] ?? '').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
      const [field = '', fieldType = ''] = t.split(/\s+/);
      if (!field) continue;
      if (modelNames.has(fieldType.replace(/[?[\]]/g, ''))) continue;
      const mapped = /@map\("([^"]+)"\)/.exec(t)?.[1];
      for (const name of [field, mapped].filter((x): x is string => Boolean(x))) {
        if (!SECRET_LIKE.test(name)) continue;
        const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (classifyField(name) === 'keep' && !KEEP_ALLOWLIST.has(n))
          problems.push(`${model}.${field}`);
      }
    }
  }
  return [...new Set(problems)];
}
