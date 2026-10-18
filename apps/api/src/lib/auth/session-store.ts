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
  /** "remember me": idle limit 8 h instead of 30 min (D79) */
  remember: boolean;
  /** step-up re-authentication (doc 52 section 2.4): when, and at which level */
  reauthAt: Date | null;
  reauthLevel: ReauthLevel | null;
  user: { name: string; roleName: Role; mustChangePassword: boolean; active: boolean };
}

export type ReauthLevel = 'PASSWORD' | 'STRONG';

/** Implemented by the auth repository (the only place that talks to Prisma). */
export interface SessionPersistence {
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  setSessionReauth(sessionId: string, at: Date, level: ReauthLevel): Promise<void>;
  /** Single use: STRONG -> PASSWORD if it is STRONG and not older than `since`; true only for the call that did it. */
  consumeStrongReauth(sessionId: string, since: Date): Promise<boolean>;
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
  reauthLevel: ReauthLevel | null;
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
  reauthLevel: ReauthLevel | null;
  remember: boolean;
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
      reauthLevel:
        o['reauthLevel'] === 'PASSWORD' || o['reauthLevel'] === 'STRONG' ? o['reauthLevel'] : null,
      remember: o['remember'] === true,
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
      /** D142: told about every eviction (revoke, logout, expiry) so realtime can drop those sessions' sockets */
      onEvicted?: (tokenHashes: string[]) => void;
    },
  ) {}

  private key = (tokenHash: string): string => `sess:${tokenHash}`;

  /** Idle limit of a session: 30 min, or 8 h with "remember me" (doc 52 section 2.6, D79). */
  idleMsFor(remember: boolean): number {
    return remember ? this.deps.config.rememberIdleTimeoutMs : this.deps.config.idleTimeoutMs;
  }

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
      remember: boolean;
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
      reauthLevel: null,
      remember: s.remember,
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
      now - cached.lastSeenAtMs > this.idleMsFor(cached.remember)
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
      reauthLevel: cached.reauthLevel,
    };
  }

  /** How long a re-authentication counts (doc 52 section 2.4): PASSWORD 10 minutes, STRONG 5 minutes. */
  reauthWindowMs(level: ReauthLevel): number {
    return level === 'STRONG'
      ? this.deps.config.strongReauthWindowMs
      : this.deps.config.reauthWindowMs;
  }

  /** Records a successful re-authentication (database and cache); returns when it stops counting. */
  async markReauth(tokenHash: string, sessionId: string, level: ReauthLevel): Promise<Date> {
    const now = this.deps.clock();
    await this.deps.persistence.setSessionReauth(sessionId, now, level);
    const cached = await this.read(tokenHash);
    if (cached) {
      cached.reauthAtMs = now.getTime();
      cached.reauthLevel = level;
      await this.write(tokenHash, cached);
    }
    return new Date(now.getTime() + this.reauthWindowMs(level));
  }

  /** PASSWORD level is enough for anything re-authenticated (either level) within 10 minutes. */
  hasRecentReauth(session: AuthSession): boolean {
    return (
      session.reauthAtMs !== null &&
      this.deps.clock().getTime() - session.reauthAtMs <= this.deps.config.reauthWindowMs
    );
  }

  /**
   * STRONG is single use (doc 52 section 2.4): one conditional UPDATE in PostgreSQL turns it back into PASSWORD, so two
   * concurrent high-risk requests cannot both spend it.
   */
  async consumeStrong(session: AuthSession): Promise<boolean> {
    const since = new Date(this.deps.clock().getTime() - this.deps.config.strongReauthWindowMs);
    const ok = await this.deps.persistence.consumeStrongReauth(session.sessionId, since);
    const cached = await this.read(session.tokenHash);
    if (cached && cached.reauthLevel === 'STRONG') {
      cached.reauthLevel = 'PASSWORD';
      await this.write(session.tokenHash, cached);
    }
    return ok;
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
    this.notifyEvicted([tokenHash]);
    try {
      await this.deps.redis.del(this.key(tokenHash));
    } catch {
      /* cache only: the database row is revoked separately */
    }
  }

  async evictMany(tokenHashes: string[]): Promise<void> {
    if (tokenHashes.length === 0) return;
    this.notifyEvicted(tokenHashes);
    await Promise.all(tokenHashes.map((h) => this.evictCacheOnly(h)));
  }

  private async evictCacheOnly(tokenHash: string): Promise<void> {
    try {
      await this.deps.redis.del(this.key(tokenHash));
    } catch {
      /* cache only: the database row is revoked separately */
    }
  }

  /** Best effort: a failing listener never blocks an eviction. */
  private notifyEvicted(tokenHashes: string[]): void {
    try {
      this.deps.onEvicted?.(tokenHashes);
    } catch {
      /* realtime only */
    }
  }

  private async loadFromDatabase(tokenHash: string, now: number): Promise<CachedSession | null> {
    const row = await this.deps.persistence.findSessionByTokenHash(tokenHash);
    if (!row || row.revokedAt || !row.user.active) return null;
    if (now >= row.expiresAt.getTime()) return null;
    if (now - row.lastSeenAt.getTime() > this.idleMsFor(row.remember)) return null;
    return {
      sessionId: row.id,
      userId: row.userId,
      name: row.user.name,
      role: row.user.roleName,
      mustChangePassword: row.user.mustChangePassword,
      absoluteExpiresAtMs: row.expiresAt.getTime(),
      lastSeenAtMs: row.lastSeenAt.getTime(),
      dbSeenAtMs: row.lastSeenAt.getTime(),
      reauthAtMs: row.reauthAt ? row.reauthAt.getTime() : null,
      reauthLevel: row.reauthLevel,
      remember: row.remember,
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
      await this.deps.redis.set(
        this.key(tokenHash),
        JSON.stringify(s),
        'EX',
        Math.ceil(this.idleMsFor(s.remember) / 1000),
      );
    } catch {
      /* cache only */
    }
  }
}
