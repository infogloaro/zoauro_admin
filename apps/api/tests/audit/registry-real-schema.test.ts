import { describe, expect, it } from 'vitest';
import { classifyField, findUncoveredSecretLikeColumns } from '../../src/lib/audit';

// Decisions taken after the real-schema check (TC-AUD-6) found seven uncovered columns in prisma/schema.prisma.
describe('registry additions after the real-schema check', () => {
  it('drops encrypted blobs and hashes from audit JSON', () => {
    for (const f of ['requestHash', 'tokenHash', 'secretEncrypted']) {
      expect(classifyField(f), f).toBe('drop');
    }
  });

  it('drops the 2-step secrets of doc 52 section 3 (secret_encrypted, code_hash) in either spelling', () => {
    for (const f of ['secretEncrypted', 'secret_encrypted', 'codeHash', 'code_hash']) {
      expect(classifyField(f), f).toBe('drop');
    }
    for (const f of ['destinationHint', 'lastUsedStep', 'phoneVerifiedAt', 'passwordChangedAt']) {
      expect(classifyField(f), f).toBe('keep');
    }
  });

  it('masks GST and FSSAI numbers spelled *No (doc 08)', () => {
    expect(classifyField('gstNo')).toBe('mask-tail');
    expect(classifyField('fssaiNo')).toBe('mask-tail');
  });

  it('keeps ordinary fields', () => {
    for (const f of ['name', 'status', 'commissionPct', 'area']) {
      expect(classifyField(f), f).toBe('keep');
    }
  });

  it('the schema walker ignores relation fields but still flags a real uncovered column', () => {
    const schema = `
model User {
  id String @id
  passwordResetTokens PasswordResetToken[]
  merchantPassphrase String
}
model PasswordResetToken {
  id String @id
  user User @relation(fields: [id], references: [id])
}`;
    expect(findUncoveredSecretLikeColumns(schema)).toEqual(['User.merchantPassphrase']);
  });
});
