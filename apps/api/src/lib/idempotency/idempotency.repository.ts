import type { Prisma } from '@prisma/client';
import type { BeginResult, IdempotencyStore } from './middleware';

// Backed by `idempotency_keys` (doc 08): key, route, user_id, request_hash, response_json, status_code, created_at.
// A row with no status_code is a request that started and has not finished.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A request still "in progress" after this long is assumed to have died with its process and may be taken over. */
export const IN_PROGRESS_TIMEOUT_MS = 60 * 1000;

export class IdempotencyRepository implements IdempotencyStore {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async begin(i: {
    key: string;
    route: string;
    userId: string | null;
    requestHash: string;
    now: Date;
  }): Promise<BeginResult> {
    const expired = new Date(i.now.getTime() - IDEMPOTENCY_TTL_MS);
    const abandoned = new Date(i.now.getTime() - IN_PROGRESS_TIMEOUT_MS);

    // Drop what no longer counts, then try to claim the key. createMany + skipDuplicates is one atomic INSERT .. ON CONFLICT DO NOTHING.
    await this.db.idempotencyKey.deleteMany({
      where: {
        key: i.key,
        OR: [{ createdAt: { lt: expired } }, { statusCode: null, createdAt: { lt: abandoned } }],
      },
    });
    const claimed = await this.db.idempotencyKey.createMany({
      data: [
        {
          key: i.key,
          route: i.route,
          userId: i.userId,
          requestHash: i.requestHash,
          createdAt: i.now,
        },
      ],
      skipDuplicates: true,
    });
    if (claimed.count === 1) return { kind: 'started' };

    const row = await this.db.idempotencyKey.findUnique({ where: { key: i.key } });
    if (!row) return { kind: 'in_progress' }; // removed between the two statements: let the client retry
    if (row.requestHash !== i.requestHash) return { kind: 'mismatch' };
    if (row.statusCode === null) return { kind: 'in_progress' };
    return { kind: 'replay', statusCode: row.statusCode, body: row.responseJson };
  }

  async complete(key: string, statusCode: number, body: unknown): Promise<void> {
    await this.db.idempotencyKey.updateMany({
      where: { key, statusCode: null },
      data: {
        statusCode,
        responseJson:
          body === undefined || body === null ? undefined : (body as Prisma.InputJsonValue),
      },
    });
  }

  /** The request failed: forget the key so the client can retry it (a corrected request is a new attempt, not a replay). */
  async abandon(key: string): Promise<void> {
    await this.db.idempotencyKey.deleteMany({ where: { key, statusCode: null } });
  }

  /** Retention: "purge after 24 h" (doc 08). Called by a worker job. */
  async purgeExpired(now: Date): Promise<number> {
    const r = await this.db.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS) } },
    });
    return r.count;
  }
}
