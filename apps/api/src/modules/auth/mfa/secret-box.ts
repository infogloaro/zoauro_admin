import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

// Authenticator secrets at rest (doc 52 section 2.2, D70): AES-256-GCM with ENCRYPTION_KEY, stored as
// "v1.<kid>.<nonce>.<ciphertext>.<tag>" (base64url). The key id lets ENCRYPTION_KEY rotate: open() tries the key whose
// id matches, current or ENCRYPTION_KEY_PREVIOUS. Associated data binds a sealed value to its place (e.g. the user id),
// so a ciphertext copied onto another account does not open.

export class SecretBoxError extends Error {
  constructor(readonly reason: 'MALFORMED' | 'UNKNOWN_KEY' | 'TAMPERED') {
    super(`secret box: ${reason}`); // never the plaintext, the key or the ciphertext
    this.name = 'SecretBoxError';
  }
}

interface BoxKey {
  kid: string;
  key: Buffer;
}

/** The env value is a passphrase-like string of 32+ characters: HKDF turns it into exactly 32 key bytes. */
function deriveKey(material: string): BoxKey {
  const kid = createHash('sha256')
    .update(`zoauro-secret-box-kid:${material}`)
    .digest('hex')
    .slice(0, 8);
  const key = Buffer.from(hkdfSync('sha256', material, 'zoauro', 'secret-box-v1', 32));
  return { kid, key };
}

export interface SecretBox {
  seal(plaintext: string, associatedData: string): string;
  open(sealed: string, associatedData: string): string;
  /** key id of the current key (for re-sealing values still under the previous one) */
  readonly currentKid: string;
}

export function createSecretBox(keys: { current: string; previous?: string }): SecretBox {
  const current = deriveKey(keys.current);
  const all = [current, ...(keys.previous ? [deriveKey(keys.previous)] : [])];
  return {
    currentKid: current.kid,
    seal(plaintext, associatedData) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current.key, nonce);
      cipher.setAAD(Buffer.from(associatedData, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return ['v1', current.kid, nonce, ct, tag]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    },
    open(sealed, associatedData) {
      const parts = sealed.split('.');
      if (parts.length !== 5 || parts[0] !== 'v1') throw new SecretBoxError('MALFORMED');
      const [, kid, nonce64, ct64, tag64] = parts as [string, string, string, string, string];
      const k = all.find((x) => x.kid === kid);
      if (!k) throw new SecretBoxError('UNKNOWN_KEY');
      const nonce = Buffer.from(nonce64, 'base64url');
      const tag = Buffer.from(tag64, 'base64url');
      if (nonce.length !== 12 || tag.length !== 16) throw new SecretBoxError('MALFORMED');
      try {
        const decipher = createDecipheriv('aes-256-gcm', k.key, nonce);
        decipher.setAAD(Buffer.from(associatedData, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(Buffer.from(ct64, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new SecretBoxError('TAMPERED');
      }
    },
  };
}

/** Associated data for an authenticator secret: it opens only for its owner (doc 32, P7). */
export const mfaSecretAad = (userId: string): string =>
  `user_mfa_methods.secret_encrypted:${userId}`;
