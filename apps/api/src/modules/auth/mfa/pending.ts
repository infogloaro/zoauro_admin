import type { Redis } from 'ioredis';
import type { Role } from '@zoauro/shared';
import { randomToken, sha256Hex } from '../../../lib/auth/crypto';

// The pending login between the password and the second step (doc 52 section 2.1 rule 1): NOT a session. An opaque
// token in the zo_mfa cookie points to a Redis record that lives 5 minutes; only the token's hash is the key. It
// authorises the 2-step routes only (/auth/mfa/*, enrolment, logout); /me and every module route ignore it.

export const PENDING_LOGIN_TTL_MS = 5 * 60 * 1000;

export type PendingStage = 'VERIFY' | 'ENROL';

export interface PendingLogin {
  userId: string;
  tab: Role;
  remember: boolean;
  /** the request that entered the password: a different IP or browser cannot continue (TC-AUTH-9) */
  ip: string | null;
  userAgent: string | null;
  stage: PendingStage;
  /** wrong second-step codes in this pending login */
  attempts: number;
  /** enrolment only: the mailbox was proven with an emailed code (doc 52 section 2.3) */
  mailboxProved: boolean;
  createdAtMs: number;
}

const isRecord = (v: unknown): v is PendingLogin => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['userId'] === 'string' &&
    (o['tab'] === 'SUPER_ADMIN' || o['tab'] === 'ZONAL_ADMIN') &&
    typeof o['remember'] === 'boolean' &&
    (o['stage'] === 'VERIFY' || o['stage'] === 'ENROL') &&
    typeof o['attempts'] === 'number' &&
    typeof o['mailboxProved'] === 'boolean' &&
    typeof o['createdAtMs'] === 'number'
  );
};

export class PendingLoginStore {
  constructor(private readonly deps: { redis: Redis; clock: () => Date }) {}

  private key = (token: string): string => `mfa:pending:${sha256Hex(token)}`;

  /** Starts a pending login; returns the cookie value (never stored itself). */
  async create(
    p: Omit<PendingLogin, 'attempts' | 'mailboxProved' | 'createdAtMs'>,
  ): Promise<string> {
    const token = randomToken(32);
    const record: PendingLogin = {
      ...p,
      attempts: 0,
      mailboxProved: false,
      createdAtMs: this.deps.clock().getTime(),
    };
    await this.deps.redis.set(this.key(token), JSON.stringify(record), 'PX', PENDING_LOGIN_TTL_MS);
    return token;
  }

  /**
   * The pending login for a cookie value, or null when unknown, expired (5 minutes on the injectable clock as well as
   * the Redis TTL) or corrupt. An expired record is deleted.
   */
  async get(token: string): Promise<PendingLogin | null> {
    const raw = await this.deps.redis.get(this.key(token));
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!isRecord(parsed)) {
      await this.end(token);
      return null;
    }
    if (this.deps.clock().getTime() - parsed.createdAtMs > PENDING_LOGIN_TTL_MS) {
      await this.end(token);
      return null;
    }
    return parsed;
  }

  /** Saves a changed record (attempts, mailboxProved) without extending its life. */
  async update(token: string, p: PendingLogin): Promise<void> {
    await this.deps.redis.set(this.key(token), JSON.stringify(p), 'KEEPTTL', 'XX');
  }

  /** Single use: the first caller gets the record and it is gone for everyone else (GETDEL). */
  async consume(token: string): Promise<PendingLogin | null> {
    const raw = await this.deps.redis.getdel(this.key(token));
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async end(token: string): Promise<void> {
    await this.deps.redis.del(this.key(token));
  }
}
