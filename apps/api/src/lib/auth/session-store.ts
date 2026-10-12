import type { Redis } from 'ioredis';
import { ROLES, type Role } from '@zoauro/shared';
import type { AuthConfig, Clock } from './config';
import { csrfTokenFor, sha256Hex } from './crypto';

// Opaque sessions (doc 14 section 2, doc 06): PostgreSQL `sessions` is the source of truth; Redis is a read-through cache
// that also carries the sliding idle window. Idle and absolute timeouts are enforced from timestamps (not from Redis TTL
// alone), so a Redis flush or outage neither extends nor ends a session by accident.

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  user: { name: string; roleName: Role; mustChangePassword: boolean; active: boolean };
}

/** Implemented by the auth repository (the only place that talks to Prisma). */
export interface SessionPersistence {
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(sessionId: string, at: Date): Promise<void>;
}

/** What a request sees after the cookie has been resolved. */
export interface AuthSession {
  sessionId: string;
  userId: string;
  /** display name when the session was loaded; snapshotted into audit rows as the actor name */
  name: string;
  role: Role;
  mustChangePassword: boolean;
  tokenHash: string;
  csrfToken: string;
  /** epoch ms of the last successful re-authentication, if any */
  reauthAtMs: number | null;
}

interface CachedSession {
  sessionId: string;
  userId: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  absoluteExpiresAtMs: number;
  lastSeenAtMs: number;
  dbSeenAtMs: number;
  reauthAtMs: number | null;
}

const isRole = (v: unknown): v is Role =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v);

function parseCached(raw: string): CachedSession | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (
      typeof o['sessionId'] !== 'string' ||
      typeof o['userId'] !== 'string' ||
      typeof o['name'] !== 'string' || // entries cached before the name was added: reload from PostgreSQL
      !isRole(o['role']) ||
      typeof o['mustChangePassword'] !== 'boolean' ||
      typeof o['absoluteExpiresAtMs'] !== 'number' ||
      typeof o['lastSeenAtMs'] !== 'number' ||
      typeof o['dbSeenAtMs'] !== 'number'
    ) {
      return null;
    }
    return {
      sessionId: o['sessionId'],
      userId: o['userId'],
      name: o['name'],
      role: o['role'],
      mustChangePassword: o['mustChangePassword'],
      absoluteExpiresAtMs: o['absoluteExpiresAtMs'],
      lastSeenAtMs: o['lastSeenAtMs'],
      dbSeenAtMs: o['dbSeenAtMs'],
      reauthAtMs: typeof o['reauthAtMs'] === 'number' ? o['reauthAtMs'] : null,
    };
  } catch {
    return null;
  }
}

export class SessionStore {
  constructor(
    private readonly deps: {
      redis: Redis;
      persistence: SessionPersistence;
      config: AuthConfig;
      clock: Clock;
      sessionSecret: string;
    },
  ) {}

  private key = (tokenHash: string): string => `sess:${tokenHash}`;
  private ttlSec = (): number => Math.ceil(this.deps.config.idleTimeoutMs / 1000);

  csrfFor(tokenHash: string): string {
    return csrfTokenFor(tokenHash, this.deps.sessionSecret);
  }

  /** Called after the login transaction committed. */
  async cacheNew(
    tokenHash: string,
    s: {
      sessionId: string;
      userId: string;
      name: string;
      role: Role;
      mustChangePassword: boolean;
      expiresAt: Date;
    },
  ): Promise<void> {
    const now = this.deps.clock().getTime();
    await this.write(tokenHash, {
      sessionId: s.sessionId,
      userId: s.userId,
      name: s.name,
      role: s.role,
      mustChangePassword: s.mustChangePassword,
      absoluteExpiresAtMs: s.expiresAt.getTime(),
      lastSeenAtMs: now,
      dbSeenAtMs: now,
      reauthAtMs: null,
    });
  }

  /** Cookie value -> session, or null when unknown, revoked, idle-expired or past the absolute limit. Slides the idle window. */
  async resolve(token: string): Promise<AuthSession | null> {
    const tokenHash = sha256Hex(token);
    const now = this.deps.clock().getTime();
    let cached = await this.read(tokenHash);
    if (!cached) {
      cached = await this.loadFromDatabase(tokenHash, now);
      if (!cached) return null;
    }
    if (
      now >= cached.absoluteExpiresAtMs ||
      now - cached.lastSeenAtMs > this.deps.config.idleTimeoutMs
    ) {
      await this.evict(tokenHash);
      return null;
    }
    cached.lastSeenAtMs = now;
    if (now - cached.dbSeenAtMs >= this.deps.config.lastSeenWriteIntervalMs) {
      await this.deps.persistence.touchSession(cached.sessionId, new Date(now));
      cached.dbSeenAtMs = now;
    }
    await this.write(tokenHash, cached);
    return {
      sessionId: cached.sessionId,
      userId: cached.userId,
      name: cached.name,
      role: cached.role,
      mustChangePassword: cached.mustChangePassword,
      tokenHash,
      csrfToken: this.csrfFor(tokenHash),
      reauthAtMs: cached.reauthAtMs,
    };
  }

  /** Records a successful re-authentication; returns when it stops counting as recent. */
  async markReauth(tokenHash: string): Promise<Date> {
    const now = this.deps.clock().getTime();
    const cached = await this.read(tokenHash);
    if (cached) {
      cached.reauthAtMs = now;
      await this.write(tokenHash, cached);
    }
    return new Date(now + this.deps.config.reauthWindowMs);
  }

  /**
   * After a successful password change the current session is no longer restricted. The cached entry is updated; if
   * Redis is down, the next resolve reloads the user's flag from PostgreSQL anyway.
   */
  async clearPasswordChange(tokenHash: string): Promise<void> {
    const cached = await this.read(tokenHash);
    if (cached) {
      cached.mustChangePassword = false;
      await this.write(tokenHash, cached);
    }
  }

  async evict(tokenHash: string): Promise<void> {
    try {
      await this.deps.redis.del(this.key(tokenHash));
    } catch {
      /* cache only: the database row is revoked separately */
    }
  }

  async evictMany(tokenHashes: string[]): Promise<void> {
    await Promise.all(tokenHashes.map((h) => this.evict(h)));
  }

  private async loadFromDatabase(tokenHash: string, now: number): Promise<CachedSession | null> {
    const row = await this.deps.persistence.findSessionByTokenHash(tokenHash);
    if (!row || row.revokedAt || !row.user.active) return null;
    if (now >= row.expiresAt.getTime()) return null;
    if (now - row.lastSeenAt.getTime() > this.deps.config.idleTimeoutMs) return null;
    return {
      sessionId: row.id,
      userId: row.userId,
      name: row.user.name,
      role: row.user.roleName,
      mustChangePassword: row.user.mustChangePassword,
      absoluteExpiresAtMs: row.expiresAt.getTime(),
      lastSeenAtMs: row.lastSeenAt.getTime(),
      dbSeenAtMs: row.lastSeenAt.getTime(),
      reauthAtMs: null,
    };
  }

  private async read(tokenHash: string): Promise<CachedSession | null> {
    try {
      const raw = await this.deps.redis.get(this.key(tokenHash));
      return raw ? parseCached(raw) : null;
    } catch {
      return null;
    }
  }

  private async write(tokenHash: string, s: CachedSession): Promise<void> {
    try {
      await this.deps.redis.set(this.key(tokenHash), JSON.stringify(s), 'EX', this.ttlSec());
    } catch {
      /* cache only */
    }
  }
}
