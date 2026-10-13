import { hash, verify } from '@node-rs/argon2';

/** Argon2id password hashing (doc 14 §2). */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
