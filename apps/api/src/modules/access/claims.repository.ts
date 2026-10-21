import type { Prisma, PrismaClient } from '@prisma/client';
import type { ClaimEntityType } from '@zoauro/shared';
import { auditTx } from '../../lib/db';
import type {
  ClaimEndReason,
  ClaimRow,
  ClaimsDatabase,
  ClaimsRepo,
  ClaimsTx,
  TakeoverDecision,
  TakeoverRow,
} from './claims.service';

// D174 record claims data (record_claims, claim_takeover_requests). The only claims file that imports Prisma. Scope
// rules live in the service (the record's zone against the caller's permissions); these queries take record ids.

const userRef = { select: { id: true, name: true } } as const;
const claimSelect = {
  id: true,
  entityType: true,
  entityId: true,
  zoneId: true,
  claimedAt: true,
  expiresAt: true,
  claimer: userRef,
  takeovers: {
    where: { status: 'PENDING' },
    select: {
      id: true,
      claimId: true,
      reason: true,
      expiresAt: true,
      createdAt: true,
      requester: userRef,
    },
    take: 1,
  },
} satisfies Prisma.RecordClaimSelect;
type Row = Prisma.RecordClaimGetPayload<{ select: typeof claimSelect }>;

const toRow = (r: Row): { claim: ClaimRow; takeover: TakeoverRow | null } => {
  const t = r.takeovers[0];
  return {
    claim: {
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      zoneId: r.zoneId,
      claimedBy: r.claimer,
      claimedAt: r.claimedAt,
      expiresAt: r.expiresAt,
    },
    takeover: t
      ? {
          id: t.id,
          claimId: t.claimId,
          requestedBy: t.requester,
          reason: t.reason,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
        }
      : null,
  };
};

export class ClaimsRepository implements ClaimsRepo {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async entity(type: ClaimEntityType, id: string): Promise<{ zoneId: string | null } | null> {
    const where = { id, deletedAt: null };
    const select = { zoneId: true } as const;
    switch (type) {
      case 'HOTEL':
        return this.db.hotel.findFirst({ where, select });
      case 'RESTAURANT':
        return this.db.restaurant.findFirst({ where, select });
      case 'HOMEMAKER':
        return this.db.homemaker.findFirst({ where, select });
      case 'DELIVERY_PARTNER':
        return this.db.deliveryPartner.findFirst({ where, select });
    }
  }

  async open(type: ClaimEntityType, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db.recordClaim.findMany({
      where: { entityType: type, entityId: { in: [...ids] }, releasedAt: null },
      select: claimSelect,
    });
    return rows.map(toRow);
  }

  async openById(id: string) {
    const r = await this.db.recordClaim.findFirst({
      where: { id, releasedAt: null },
      select: claimSelect,
    });
    return r ? toRow(r) : null;
  }

  async openOf(userId: string) {
    const rows = await this.db.recordClaim.findMany({
      where: { claimedBy: userId, releasedAt: null },
      select: claimSelect,
      orderBy: { claimedAt: 'desc' },
      take: 200,
    });
    return rows.map(toRow);
  }

  async lockRecord(type: ClaimEntityType, id: string): Promise<void> {
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`claim:${type}:${id}`}))`;
  }

  async insert(c: {
    id: string;
    type: ClaimEntityType;
    entityId: string;
    zoneId: string | null;
    userId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.recordClaim.create({
      data: {
        id: c.id,
        entityType: c.type,
        entityId: c.entityId,
        zoneId: c.zoneId,
        claimedBy: c.userId,
        claimedAt: c.now,
        lastActivityAt: c.now,
        expiresAt: c.expiresAt,
      },
    });
  }

  async extend(id: string, now: Date, expiresAt: Date): Promise<void> {
    await this.db.recordClaim.updateMany({
      where: { id, releasedAt: null },
      data: { lastActivityAt: now, expiresAt, version: { increment: 1 } },
    });
  }

  async end(
    id: string,
    reason: ClaimEndReason,
    by: string | null,
    now: Date,
    note?: string,
  ): Promise<void> {
    await this.db.recordClaim.updateMany({
      where: { id, releasedAt: null },
      data: {
        releasedAt: now,
        releasedBy: by,
        endReason: reason,
        ...(note ? { note } : {}),
        version: { increment: 1 },
      },
    });
  }

  async insertTakeover(t: {
    id: string;
    claimId: string;
    userId: string;
    reason: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.claimTakeoverRequest.create({
      data: {
        id: t.id,
        claimId: t.claimId,
        requestedBy: t.userId,
        reason: t.reason,
        expiresAt: t.expiresAt,
        createdAt: t.now,
      },
    });
  }

  async decideTakeover(
    id: string,
    status: TakeoverDecision,
    by: string | null,
    now: Date,
  ): Promise<void> {
    await this.db.claimTakeoverRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, decidedBy: by, decidedAt: now },
    });
  }

  async expireDue(now: Date): Promise<{ claims: number; takeovers: number }> {
    const takeovers = await this.db.claimTakeoverRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', decidedAt: now },
    });
    const claims = await this.db.recordClaim.updateMany({
      where: { releasedAt: null, expiresAt: { lte: now } },
      data: { releasedAt: now, endReason: 'EXPIRED', version: { increment: 1 } },
    });
    return { claims: claims.count, takeovers: takeovers.count };
  }
}

export class ClaimsPrismaDatabase implements ClaimsDatabase {
  readonly repo: ClaimsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new ClaimsRepository(prisma);
  }

  transaction<T>(fn: (tx: ClaimsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new ClaimsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
