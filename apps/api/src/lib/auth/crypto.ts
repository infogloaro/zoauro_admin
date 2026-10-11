import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Algorithm, hash, verify } from '@node-rs/argon2';

// The library exports Algorithm as a const enum, which isolatedModules cannot import by value: 2 is Algorithm.Argon2id.
const ARGON2ID = 2 as Algorithm;

// Argon2id with the library defaults (OWASP-class parameters). The encoded hash carries its own parameters,
// so raising them later keeps old hashes verifiable.
export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false; // malformed hash: treat as a mismatch, never throw into the login path
  }
}

/** A valid Argon2id hash nobody knows the password of; verified when the account does not exist so timing does not reveal it. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummyHash;
}

/** 256-bit opaque value for session cookies and reset links. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Only the hash of a session or reset token is stored (doc 08: token_hash). */
export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** CSRF token bound to one session: HMAC of the stored token hash with SESSION_SECRET. Stateless, so a Redis flush cannot lose it. */
export const csrfTokenFor = (sessionTokenHash: string, secret: string): string =>
  createHmac('sha256', secret).update(`csrf:${sessionTokenHash}`).digest('base64url');
