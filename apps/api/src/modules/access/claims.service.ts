import type {
  Claim,
  ClaimEntityType,
  CreateClaimInput,
  OverrideClaimInput,
  PermissionKey,
  RecordClaimedMeta,
} from '@zoauro/shared';
import { noteAuditNoop, record, uuidv7, type AuditTx } from '../../lib/audit';
import { can, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';

// D174 record claims. Rules live here; the repository (Prisma, record_claims and claim_takeover_requests) only reads
// and writes. Expiry is lazy: an open claim past expires_at, or a pending takeover past its expires_at, counts as
// expired on every read and is closed on the next write (a sweep job closes the rest). An expired takeover request moves
// nothing (no auto-transfer). Scope: the record's zone; an unzoned record is Super Admin only; out of scope is 404.

export interface ClaimRow {
  id: string;
  entityType: ClaimEntityType;
  entityId: string;
  zoneId: string | null;
  claimedBy: { id: string; name: string };
  claimedAt: Date;
  expiresAt: Date;
}
export interface TakeoverRow {
  id: string;
  claimId: string;
  requestedBy: { id: string; name: string };
  reason: string;
  expiresAt: Date;
  createdAt: Date;
}
export type ClaimEndReason = 'RELEASED' | 'EXPIRED' | 'OVERRIDDEN' | 'TAKEN_OVER';
export type TakeoverDecision = 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export interface ClaimsRepo {
  /** the record's zone; null when the record does not exist (or is deleted) */
  entity(type: ClaimEntityType, id: string): Promise<{ zoneId: string | null } | null>;
  /** open (not released) claims of these records, with their pending takeover request */
  open(
    type: ClaimEntityType,
    ids: readonly string[],
  ): Promise<{ claim: ClaimRow; takeover: TakeoverRow | null }[]>;
  openById(id: string): Promise<{ claim: ClaimRow; takeover: TakeoverRow | null } | null>;
  openOf(userId: string): Promise<{ claim: ClaimRow; takeover: TakeoverRow | null }[]>;
  /** serialises claim writes of one record for the rest of the transaction */
  lockRecord(type: ClaimEntityType, id: string): Promise<void>;
  insert(c: {
    id: string;
    type: ClaimEntityType;
    entityId: string;
    zoneId: string | null;
    userId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void>;
  extend(id: string, now: Date, expiresAt: Date): Promise<void>;
  end(
    id: string,
    reason: ClaimEndReason,
    by: string | null,
    now: Date,
    note?: string,
  ): Promise<void>;
  insertTakeover(t: {
    id: string;
    claimId: string;
    userId: string;
    reason: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void>;
  decideTakeover(id: string, status: TakeoverDecision, by: string | null, now: Date): Promise<void>;
  /** closes expired claims and takeover requests; returns how many */
  expireDue(now: Date): Promise<{ claims: number; takeovers: number }>;
}

export interface ClaimsTx {
  repo: ClaimsRepo;
  audit: AuditTx;
}
export interface ClaimsDatabase {
  repo: ClaimsRepo;
  transaction<T>(fn: (tx: ClaimsTx) => Promise<T>): Promise<T>;
}

/** What a claim event tells the realtime and notification modules (optional hook). */
export interface ClaimEvent {
  type:
    | 'claim.takeover_requested'
    | 'claim.takeover_approved'
    | 'claim.takeover_rejected'
    | 'claim.takeover_expired'
    | 'claim.overridden';
  claimId: string;
  entityType: ClaimEntityType;
  entityId: string;
  zoneId: string | null;
  /** who should hear about it: the claimer, the requester (approve/reject), the zone's Super Admins (resolved by the hook) */
  userIds: string[];
}

const MODULE_OF: Record<ClaimEntityType, 'hotels' | 'restaurants' | 'homemakers' | 'delivery'> = {
  HOTEL: 'hotels',
  RESTAURANT: 'restaurants',
  HOMEMAKER: 'homemakers',
  DELIVERY_PARTNER: 'delivery',
};
const key = (type: ClaimEntityType, action: 'view' | 'edit'): PermissionKey =>
  `${MODULE_OF[type]}:${action}`;

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');

export function recordClaimed(c: ClaimRow): AppError {
  const meta: RecordClaimedMeta = {
    claimId: c.id,
    claimedBy: c.claimedBy,
    expiresAt: c.expiresAt.toISOString(),
  };
  return new AppError(
    'RECORD_CLAIMED',
    `${c.claimedBy.name} is working on this record`,
    undefined,
    undefined,
    meta,
  );
}

export class ClaimsService {
  constructor(
    private readonly deps: {
      db: ClaimsDatabase;
      clock: () => Date;
      /** settings claims.timing (D174) */
      timing: () => Promise<{ ttlMinutes: number; takeoverTimeoutMinutes: number }>;
      onEvent?: (e: ClaimEvent) => void;
    },
  ) {}

  private live = (c: ClaimRow, now: Date) => c.expiresAt > now;

  private dto(
    ctx: AuthContext,
    { claim, takeover }: { claim: ClaimRow; takeover: TakeoverRow | null },
    now: Date,
  ): Claim {
    const pending = takeover && takeover.expiresAt > now ? takeover : null;
    return {
      id: claim.id,
      entityType: claim.entityType,
      entityId: claim.entityId,
      zoneId: claim.zoneId,
      claimedBy: claim.claimedBy,
      claimedAt: claim.claimedAt.toISOString(),
      expiresAt: claim.expiresAt.toISOString(),
      isMine: claim.claimedBy.id === ctx.userId,
      pendingTakeover: pending
        ? {
            id: pending.id,
            requestedBy: pending.requestedBy,
            reason: pending.reason,
            expiresAt: pending.expiresAt.toISOString(),
          }
        : null,
    };
  }

  /** 404 for a record out of the caller's scope (unzoned: Super Admin only). */
  private assertScope(
    ctx: AuthContext,
    type: ClaimEntityType,
    zoneId: string | null,
    action: 'view' | 'edit',
  ) {
    if (ctx.isSuperAdmin) return;
    if (zoneId === null || !ctx.assignedZoneIds.includes(zoneId)) throw notFound();
    if (!can(ctx, key(type, action), zoneId)) {
      if (action === 'view') throw notFound();
      throw forbidden();
    }
  }

  private emit(e: ClaimEvent) {
    try {
      this.deps.onEvent?.(e);
    } catch {
      /* notifications never undo a committed change */
    }
  }

  // ---- reads ------------------------------------------------------------------------------------------------------

  /** GET /claims?entityType=&entityId=…: open claims among records the caller may view; others are silently left out. */
  async lookup(ctx: AuthContext, type: ClaimEntityType, ids: readonly string[]): Promise<Claim[]> {
    const now = this.deps.clock();
    const rows = await this.deps.db.repo.open(type, [...new Set(ids)]);
    return rows
      .filter((r) => this.live(r.claim, now))
      .filter(
        (r) =>
          ctx.isSuperAdmin ||
          (r.claim.zoneId !== null && can(ctx, key(type, 'view'), r.claim.zoneId)),
      )
      .map((r) => this.dto(ctx, r, now));
  }

  /** GET /claims/mine */
  async mine(ctx: AuthContext): Promise<Claim[]> {
    const now = this.deps.clock();
    return (await this.deps.db.repo.openOf(ctx.userId))
      .filter((r) => this.live(r.claim, now))
      .map((r) => this.dto(ctx, r, now));
  }

  // ---- claim, extend, release -------------------------------------------------------------------------------------

  private async expiresAt(now: Date): Promise<Date> {
    const { ttlMinutes } = await this.deps.timing();
    return new Date(now.getTime() + ttlMinutes * 60_000);
  }

  /** POST /claims: a new claim (201), or the caller's own extended (200); someone else's live claim is 409. */
  async claim(
    ctx: AuthContext,
    input: CreateClaimInput,
  ): Promise<{ claim: Claim; created: boolean }> {
    const entity = await this.deps.db.repo.entity(input.entityType, input.entityId);
    if (!entity) throw notFound();
    this.assertScope(ctx, input.entityType, entity.zoneId, 'edit');
    const now = this.deps.clock();
    const until = await this.expiresAt(now);
    const created = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockRecord(input.entityType, input.entityId);
      const [open] = await tx.repo.open(input.entityType, [input.entityId]);
      if (open) {
        if (open.claim.claimedBy.id === ctx.userId && this.live(open.claim, now)) {
          await tx.repo.extend(open.claim.id, now, until);
          noteAuditNoop(); // already the caller's: only the expiry moves
          return false;
        }
        if (this.live(open.claim, now)) throw recordClaimed(open.claim);
        await tx.repo.end(open.claim.id, 'EXPIRED', null, now);
        if (open.takeover) await tx.repo.decideTakeover(open.takeover.id, 'EXPIRED', null, now);
      }
      const claimId = this.newId();
      await tx.repo.insert({
        id: claimId,
        type: input.entityType,
        entityId: input.entityId,
        zoneId: entity.zoneId,
        userId: ctx.userId,
        now,
        expiresAt: until,
      });
      await record(tx.audit, {
        module: 'access',
        action: 'claim.created',
        entity: claimEntity(input.entityType, input.entityId, entity.zoneId),
        after: { expiresAt: until.toISOString() },
      });
      return true;
    });
    const [row] = await this.deps.db.repo.open(input.entityType, [input.entityId]);
    if (!row) throw notFound();
    return { claim: this.dto(ctx, row, now), created };
  }

  private newId = (): string => uuidv7();

  /** The caller's own live claim, or 404 (someone else's or ended). */
  private async own(ctx: AuthContext, id: string) {
    const row = await this.deps.db.repo.openById(id);
    const now = this.deps.clock();
    if (!row || !this.live(row.claim, now) || row.claim.claimedBy.id !== ctx.userId)
      throw notFound();
    return { row, now };
  }

  /** POST /claims/{id}/extend */
  async extend(ctx: AuthContext, id: string): Promise<Claim> {
    const { row, now } = await this.own(ctx, id);
    const until = await this.expiresAt(now);
    await this.deps.db.repo.extend(id, now, until);
    return this.dto(ctx, { ...row, claim: { ...row.claim, expiresAt: until } }, now);
  }

  /** DELETE /claims/{id}: the claimer lets go. */
  async release(ctx: AuthContext, id: string, reason?: string): Promise<void> {
    const { row, now } = await this.own(ctx, id);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.end(id, 'RELEASED', ctx.userId, now, reason);
      if (row.takeover) await tx.repo.decideTakeover(row.takeover.id, 'CANCELLED', null, now);
      await record(tx.audit, {
        module: 'access',
        action: 'claim.released',
        entity: claimEntity(row.claim.entityType, row.claim.entityId, row.claim.zoneId),
        ...(reason ? { note: reason } : {}),
      });
    });
  }

  /**
   * For the record modules' write services: a live claim by someone else is 409 RECORD_CLAIMED (same meta as POST
   * /claims); the caller's own claim is extended by the activity. No claim: the write goes ahead.
   */
  async assertNotClaimedByOther(
    ctx: AuthContext,
    type: ClaimEntityType,
    id: string,
  ): Promise<void> {
    const now = this.deps.clock();
    const [open] = await this.deps.db.repo.open(type, [id]);
    if (!open || !this.live(open.claim, now)) return;
    if (open.claim.claimedBy.id !== ctx.userId) throw recordClaimed(open.claim);
    await this.deps.db.repo.extend(open.claim.id, now, await this.expiresAt(now));
  }

  // ---- takeover and override --------------------------------------------------------------------------------------

  /** POST /claims/{id}/takeover-requests: someone with edit in the zone asks the claimer to hand over. */
  async requestTakeover(ctx: AuthContext, id: string, reason: string) {
    const row = await this.deps.db.repo.openById(id);
    const now = this.deps.clock();
    if (!row || !this.live(row.claim, now)) throw notFound();
    this.assertScope(ctx, row.claim.entityType, row.claim.zoneId, 'edit');
    if (row.claim.claimedBy.id === ctx.userId)
      throw new AppError('CONFLICT', 'This record is already yours', [
        { field: 'id', issue: 'OWN_CLAIM' },
      ]);
    if (row.takeover && row.takeover.expiresAt > now)
      throw new AppError('CONFLICT', 'A takeover request is already waiting', [
        { field: 'id', issue: 'TAKEOVER_PENDING' },
      ]);
    const { takeoverTimeoutMinutes } = await this.deps.timing();
    const expiresAt = new Date(now.getTime() + takeoverTimeoutMinutes * 60_000);
    const requestId = this.newId();
    await this.deps.db.transaction(async (tx) => {
      if (row.takeover) await tx.repo.decideTakeover(row.takeover.id, 'EXPIRED', null, now);
      await tx.repo.insertTakeover({
        id: requestId,
        claimId: id,
        userId: ctx.userId,
        reason,
        now,
        expiresAt,
      });
      await record(tx.audit, {
        module: 'access',
        action: 'claim.takeover_requested',
        entity: claimEntity(row.claim.entityType, row.claim.entityId, row.claim.zoneId),
        note: reason,
      });
    });
    this.emit({
      type: 'claim.takeover_requested',
      claimId: id,
      entityType: row.claim.entityType,
      entityId: row.claim.entityId,
      zoneId: row.claim.zoneId,
      userIds: [row.claim.claimedBy.id],
    });
    const saved = (await this.deps.db.repo.openById(id))?.takeover;
    return {
      id: requestId,
      claimId: id,
      requestedBy: saved?.requestedBy ?? { id: ctx.userId, name: '' },
      reason,
      status: 'PENDING' as const,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    };
  }

  /** POST /claims/{id}/takeover-requests/{rid}/approve | /reject: the claimer answers. Approve hands the claim over. */
  async decideTakeover(
    ctx: AuthContext,
    id: string,
    requestId: string,
    approve: boolean,
  ): Promise<Claim | null> {
    const { row, now } = await this.own(ctx, id);
    const t = row.takeover;
    if (!t || t.id !== requestId || t.expiresAt <= now) throw notFound();
    const until = await this.expiresAt(now);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockRecord(row.claim.entityType, row.claim.entityId);
      await tx.repo.decideTakeover(t.id, approve ? 'APPROVED' : 'REJECTED', ctx.userId, now);
      if (approve) {
        await tx.repo.end(id, 'TAKEN_OVER', ctx.userId, now);
        await tx.repo.insert({
          id: this.newId(),
          type: row.claim.entityType,
          entityId: row.claim.entityId,
          zoneId: row.claim.zoneId,
          userId: t.requestedBy.id,
          now,
          expiresAt: until,
        });
      }
      await record(tx.audit, {
        module: 'access',
        action: approve ? 'claim.takeover_approved' : 'claim.takeover_rejected',
        entity: claimEntity(row.claim.entityType, row.claim.entityId, row.claim.zoneId),
        after: { requestedBy: t.requestedBy.id },
      });
    });
    this.emit({
      type: approve ? 'claim.takeover_approved' : 'claim.takeover_rejected',
      claimId: id,
      entityType: row.claim.entityType,
      entityId: row.claim.entityId,
      zoneId: row.claim.zoneId,
      userIds: [t.requestedBy.id, ctx.userId],
    });
    if (!approve) return this.dto(ctx, { claim: row.claim, takeover: null }, now);
    const [next] = await this.deps.db.repo.open(row.claim.entityType, [row.claim.entityId]);
    return next ? this.dto(ctx, next, now) : null;
  }

  /** POST /claims/{id}/override: Super Admin only (route: PASSWORD), reason, audited; optionally takes the claim. */
  async override(ctx: AuthContext, id: string, input: OverrideClaimInput): Promise<Claim | null> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const row = await this.deps.db.repo.openById(id);
    const now = this.deps.clock();
    if (!row) throw notFound();
    const until = await this.expiresAt(now);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockRecord(row.claim.entityType, row.claim.entityId);
      await tx.repo.end(id, 'OVERRIDDEN', ctx.userId, now, input.reason);
      if (row.takeover) await tx.repo.decideTakeover(row.takeover.id, 'CANCELLED', null, now);
      if (input.claim)
        await tx.repo.insert({
          id: this.newId(),
          type: row.claim.entityType,
          entityId: row.claim.entityId,
          zoneId: row.claim.zoneId,
          userId: ctx.userId,
          now,
          expiresAt: until,
        });
      await record(tx.audit, {
        module: 'access',
        action: 'claim.overridden',
        entity: claimEntity(row.claim.entityType, row.claim.entityId, row.claim.zoneId),
        before: { claimedBy: row.claim.claimedBy.id },
        after: { claimedBy: input.claim ? ctx.userId : null },
        note: input.reason,
      });
    });
    this.emit({
      type: 'claim.overridden',
      claimId: id,
      entityType: row.claim.entityType,
      entityId: row.claim.entityId,
      zoneId: row.claim.zoneId,
      userIds: [row.claim.claimedBy.id],
    });
    if (!input.claim) return null;
    const [next] = await this.deps.db.repo.open(row.claim.entityType, [row.claim.entityId]);
    return next ? this.dto(ctx, next, now) : null;
  }

  /** The sweep job: closes expired claims and takeover requests (lazy expiry covers reads in between). */
  sweepExpired(): Promise<{ claims: number; takeovers: number }> {
    return this.deps.db.repo.expireDue(this.deps.clock());
  }
}

const claimEntity = (type: ClaimEntityType, id: string, zoneId: string | null) => ({
  type: type.toLowerCase(),
  id,
  ...(zoneId ? { zoneId } : {}),
});
