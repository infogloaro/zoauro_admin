import type {
  AuditActionKey,
  PartnerCreateInput,
  PartnerDetail,
  PartnerDocument,
  PartnerDocumentAttachInput,
  PartnerDocumentVerifyInput,
  PartnerForceOfflineInput,
  PartnerListItem,
  PartnerListQuery,
  PartnerListResponse,
  PartnerMoveZoneInput,
  PartnerStatusInput,
  PartnerUpdateInput,
  PartnerVerificationInput,
} from '@zoauro/shared';
import { OTHER_DOCUMENT_CODE } from '@zoauro/shared';
import { maskEmail, maskPhone, record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { ObjectStorage } from '../../lib/storage';
import {
  assertPartnerStatusTransition,
  assertPartnerVerificationDecision,
  isAssignable,
  partnerStatusAction,
  statusAfterVerification,
} from './partner.state';
import {
  partnerForceOfflineRow,
  partnerStatusChangedRow,
  partnerUpdatedRow,
} from './partners.events';
import type {
  PartnerDocumentRecord,
  PartnerRecord,
  PartnersDatabase,
  PartnersTx,
  PartnerWrite,
} from './partners.repository';

// Delivery partners (M10) and Partner Requests (R12): doc 09, doc 10 section 5, doc 22, doc 44, D22/D130 (verification
// separate from status), D97 (checklist), D121 (cap), D123 (audited reveal), D131 (routes mirror vendors), D132 (the
// R12 queue is the list filtered to verification PENDING), D133 (assignable). Every write: visible (404) -> in a zone
// (409: move it into one first) -> the action in that zone (403) -> row lock -> rules -> audit + outbox, one transaction.

const REVEALS_PER_HOUR = 30;
/** No "lift" route exists, so a forced-offline period always ends (doc 32). */
const MAX_FORCE_OFFLINE_MS = 30 * 24 * 60 * 60 * 1000;

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'Not allowed');
const stale = (current: PartnerRecord) =>
  new AppError(
    'STALE_VERSION',
    'This partner was changed by someone else. Review the newer values and try again',
    [{ field: 'version', issue: 'stale' }],
    undefined,
    { current: { id: current.id, version: current.version } },
  );
const phoneTaken = () =>
  new AppError('CONFLICT', 'Another delivery partner already uses this phone number', [
    { field: 'phone', issue: 'taken' },
  ]);

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function reviewOf(d: PartnerDocumentRecord): 'PENDING' | 'VERIFIED' | 'REJECTED' {
  return d.verified ? 'VERIFIED' : d.rejectionNote ? 'REJECTED' : 'PENDING';
}

/** D145: the DELIVERY_PARTNER document catalogue (settings onboarding.documents); null = not configured. */
export interface PartnerChecklistSource {
  onboardingCatalogue(
    party: 'DELIVERY_PARTNER',
  ): Promise<{ code: string; label: string; mandatory: boolean }[] | null>;
}

export interface PartnerUploadsGate {
  assertUploaded(ctx: AuthContext, fileKey: string): Promise<unknown>;
}

export class PartnersService {
  constructor(
    private readonly deps: {
      db: PartnersDatabase;
      clock: () => Date;
      /** D121: effective delivery.maxConcurrentOrders of a zone */
      maxConcurrentOrders: (zoneId: string) => Promise<number>;
      checklist: PartnerChecklistSource;
      storage: ObjectStorage;
      uploads: PartnerUploadsGate;
      limiter: RateLimiter;
    },
  ) {}

  // ---- reads ------------------------------------------------------------------------------------------------------

  async list(ctx: AuthContext, q: PartnerListQuery): Promise<PartnerListResponse> {
    const now = this.deps.clock();
    const { rows, total, counts } = await this.deps.db.repo.list(ctx, q, now);
    const caps = await this.capsOf(rows);
    return {
      data: rows.map((r) => this.toListItem(r, caps, now)),
      meta: { page: q.page, pageSize: q.pageSize, total, counts },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<PartnerDetail> {
    const p = await this.deps.db.repo.find(ctx, id);
    if (!p) throw notFound();
    return this.toDetail(p);
  }

  /** D123: the unmasked phone and email, audited (no audit row = no data, D61) and rate-limited. */
  async reveal(
    ctx: AuthContext,
    id: string,
  ): Promise<{ phone: string | null; email: string | null }> {
    const p = await this.deps.db.repo.find(ctx, id);
    if (!p) throw notFound();
    // an unzoned app sign-up cannot carry a zone-scoped audit row: give it a zone first
    if (p.zoneId === null)
      throw new AppError('CONFLICT', 'Move the partner into a zone before revealing the contact');
    if (!ctx.isSuperAdmin && !ctx.limitsByZone.get(p.zoneId)?.canReveal) throw forbidden();
    const hit = await this.deps.limiter.hit(`partner-reveal:${ctx.userId}`, REVEALS_PER_HOUR, 3600);
    if (!hit.allowed)
      throw new AppError('RATE_LIMITED', 'Too many reveals. Try again later.', undefined, {
        'Retry-After': String(Math.max(1, hit.retryAfterSec)),
      });
    await this.deps.db.transaction((tx) =>
      this.audit(tx, p, 'contact_revealed', undefined, undefined),
    );
    return { phone: p.phone, email: p.email };
  }

  // ---- writes -----------------------------------------------------------------------------------------------------

  /** POST /delivery-partners: one of the actor's zones (R-ACC-6, R-DEL-2), phone unique (doc 22). */
  async create(ctx: AuthContext, input: PartnerCreateInput): Promise<PartnerDetail> {
    assertCanWrite(ctx, 'delivery:add', input.zoneId);
    const id = uuidv7();
    await this.deps.db.transaction(async (tx) => {
      const zone = await tx.repo.zone(input.zoneId);
      if (!zone) throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
      if (await tx.repo.phoneTaken(input.phone, null)) throw phoneTaken();
      await tx.repo.insert({
        id,
        zoneId: input.zoneId,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        vehicleType: input.vehicleType ?? null,
        vehicleNo: input.vehicleNo ?? null,
        area: input.area ?? null,
        createdBy: ctx.userId,
      });
      const p = await this.reload(tx, id);
      await this.audit(tx, p, 'created', undefined, this.auditView(p));
    });
    return this.detail(ctx, id);
  }

  /** PATCH /delivery-partners/{id} (doc 44: delivery:edit), version-locked (D130). */
  async update(ctx: AuthContext, id: string, input: PartnerUpdateInput): Promise<PartnerDetail> {
    await this.writable(ctx, id, 'edit');
    const { version, ...changes } = input;
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.version !== version) throw stale(before);
      if (
        changes.phone &&
        changes.phone !== before.phone &&
        (await tx.repo.phoneTaken(changes.phone, id))
      )
        throw phoneTaken();
      const data: PartnerWrite = {};
      for (const [k, v] of Object.entries(changes) as [keyof PartnerWrite, unknown][])
        if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      if (!(await tx.repo.update(id, version, data, ctx.userId))) throw stale(before);
      const after = await this.reload(tx, id);
      await this.audit(tx, after, 'updated', this.auditView(before), this.auditView(after));
    });
    return this.detail(ctx, id);
  }

  /** POST /delivery-partners/{id}/status (D131): ACTIVE needs VERIFIED; INACTIVE/SUSPENDED only from ACTIVE. */
  async setStatus(ctx: AuthContext, id: string, input: PartnerStatusInput): Promise<PartnerDetail> {
    const first = await this.writable(ctx, id, 'status');
    assertPartnerStatusTransition(first.status, first.verificationStatus, input.status);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      assertPartnerStatusTransition(before.status, before.verificationStatus, input.status);
      // suspending or deactivating takes the partner off duty at once (doc 43: "suspended: sign out of duty")
      await tx.repo.set(
        id,
        input.status === 'ACTIVE'
          ? { status: input.status }
          : { status: input.status, isOnline: false },
        ctx.userId,
      );
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        partnerStatusAction(input.status),
        { status: before.status },
        { status: after.status },
        input.reason,
      );
      await tx.repo.insertOutbox([partnerStatusChangedRow(after, ctx.userId, this.deps.clock())]);
    });
    return this.detail(ctx, id);
  }

  /** POST /delivery-partners/{id}/verification (doc 09; D132: a rejection note asks for more information). */
  async verify(
    ctx: AuthContext,
    id: string,
    input: PartnerVerificationInput,
  ): Promise<PartnerDetail> {
    const first = await this.writable(ctx, id, 'status');
    assertPartnerVerificationDecision(first.verificationStatus);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      assertPartnerVerificationDecision(before.verificationStatus);
      const verified = input.decision === 'VERIFIED';
      const now = this.deps.clock();
      await tx.repo.set(
        id,
        {
          verificationStatus: input.decision,
          verificationNote: verified ? null : (input.note ?? null),
          verifiedAt: verified ? now : null,
          verifiedBy: verified ? ctx.userId : null,
          status: statusAfterVerification(before.status, input.decision),
        },
        ctx.userId,
      );
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        verified ? 'verified' : 'rejected',
        { verificationStatus: before.verificationStatus, status: before.status },
        { verificationStatus: after.verificationStatus, status: after.status },
        input.note,
      );
      await tx.repo.insertOutbox([partnerStatusChangedRow(after, ctx.userId, now)]);
    });
    return this.detail(ctx, id);
  }

  /** POST /delivery-partners/{id}/force-offline (doc 09, doc 44): until a time, reason sent to the app. */
  async forceOffline(
    ctx: AuthContext,
    id: string,
    input: PartnerForceOfflineInput,
  ): Promise<PartnerDetail> {
    await this.writable(ctx, id, 'status');
    const now = this.deps.clock();
    const until = new Date(input.until);
    if (until <= now || until.getTime() - now.getTime() > MAX_FORCE_OFFLINE_MS)
      throw new AppError('VALIDATION_ERROR', 'Choose a time in the next 30 days', [
        { field: 'until', issue: 'out_of_range' },
      ]);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      await tx.repo.set(id, { forceOfflineUntil: until, isOnline: false }, ctx.userId);
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        'force_offline',
        { isOnline: before.isOnline, forceOfflineUntil: iso(before.forceOfflineUntil) },
        { isOnline: false, forceOfflineUntil: until.toISOString() },
        input.reason,
      );
      await tx.repo.insertOutbox([
        partnerForceOfflineRow(after, ctx.userId, now, input.reason, until),
      ]);
    });
    return this.detail(ctx, id);
  }

  /**
   * POST /delivery-partners/{id}/move-zone (D131: Super Admin only, PASSWORD re-auth at the route; R-DEL-2 one zone).
   * Refused while the partner carries orders. Also places an unzoned app sign-up (D53).
   */
  async moveZone(
    ctx: AuthContext,
    id: string,
    input: PartnerMoveZoneInput,
  ): Promise<PartnerDetail> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const p = await this.deps.db.repo.find(ctx, id);
    if (!p) throw notFound();
    if (p.zoneId === input.zoneId)
      throw new AppError('VALIDATION_ERROR', 'The partner is already in this zone', [
        { field: 'zoneId', issue: 'same_zone' },
      ]);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.currentOrders > 0)
        throw new AppError('CONFLICT', 'The partner is carrying orders; move them after delivery', [
          { field: 'zoneId', issue: 'open_orders' },
        ]);
      const zone = await tx.repo.zone(input.zoneId);
      if (!zone) throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
      await tx.repo.set(id, { zoneId: zone.id, zoneAssignmentStatus: 'ASSIGNED' }, ctx.userId);
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        'zone_moved',
        { zoneId: before.zoneId },
        { zoneId: zone.id },
        input.reason,
      );
      await tx.repo.insertOutbox([
        partnerUpdatedRow(after, ctx.userId, this.deps.clock(), {
          zoneId: zone.id,
          zoneName: zone.name,
        }),
      ]);
    });
    return this.detail(ctx, id);
  }

  /** DELETE /delivery-partners/{id} (D131: PASSWORD at the route; not ACTIVE; no open orders). Soft delete. */
  async remove(ctx: AuthContext, id: string): Promise<void> {
    await this.writable(ctx, id, 'delete');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.status === 'ACTIVE')
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'Deactivate the partner before deleting them',
        );
      if (before.currentOrders > 0)
        throw new AppError('CONFLICT', 'The partner is carrying orders', [
          { field: 'id', issue: 'open_orders' },
        ]);
      await tx.repo.softDelete(id, ctx.userId, this.deps.clock());
      await this.audit(tx, before, 'deleted', this.auditView(before), undefined);
    });
  }

  // ---- documents (D97, D120, D131) --------------------------------------------------------------------------------

  async attachDocument(
    ctx: AuthContext,
    id: string,
    input: PartnerDocumentAttachInput,
  ): Promise<PartnerDetail> {
    const p = await this.writable(ctx, id, 'edit');
    if (!input.fileKey.startsWith(`zone/${p.zoneId}/${p.id}/`))
      throw new AppError('VALIDATION_ERROR', 'The file was uploaded for another record', [
        { field: 'fileKey', issue: 'other_entity' },
      ]);
    if (input.docType !== OTHER_DOCUMENT_CODE) {
      // D145: one of the catalogue's types, or OTHER
      const catalogue = await this.deps.checklist.onboardingCatalogue('DELIVERY_PARTNER');
      if (!catalogue?.some((d) => d.code === input.docType))
        throw new AppError(
          'VALIDATION_ERROR',
          'This document type is not in the onboarding catalogue',
          [{ field: 'docType', issue: 'UNKNOWN_DOCUMENT_TYPE' }],
        );
    }
    await this.deps.uploads.assertUploaded(ctx, input.fileKey);
    await this.deps.db.transaction(async (tx) => {
      const docId = uuidv7();
      await tx.repo.insertDocument({
        id: docId,
        partnerId: id,
        docType: input.docType,
        fileKey: input.fileKey,
        createdBy: ctx.userId,
      });
      await this.audit(tx, p, 'document_added', undefined, {
        docType: input.docType,
        documentId: docId,
      });
    });
    return this.detail(ctx, id);
  }

  /** A 300 s signed read link; every link is an audited view (D61: no audit row, no link). */
  async documentUrl(
    ctx: AuthContext,
    id: string,
    docId: string,
  ): Promise<{ url: string; expiresInSec: number }> {
    const p = await this.deps.db.repo.find(ctx, id);
    if (!p) throw notFound();
    if (p.zoneId === null)
      throw new AppError('CONFLICT', 'Move the partner into a zone before viewing documents');
    const doc = await this.deps.db.repo.document(id, docId);
    if (!doc) throw notFound();
    await this.deps.db.transaction((tx) =>
      this.audit(tx, p, 'document_viewed', undefined, undefined, `${doc.docType} ${doc.id}`),
    );
    return { url: await this.deps.storage.presignRead(doc.fileKey), expiresInSec: 300 };
  }

  async verifyDocument(
    ctx: AuthContext,
    id: string,
    docId: string,
    input: PartnerDocumentVerifyInput,
  ): Promise<PartnerDetail> {
    const p = await this.writable(ctx, id, 'status');
    const doc = await this.deps.db.repo.document(id, docId);
    if (!doc) throw notFound();
    if (reviewOf(doc) !== 'PENDING')
      throw new AppError('INVALID_STATE_TRANSITION', 'This document has already been reviewed');
    const verified = input.decision === 'VERIFIED';
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.reviewDocument(docId, {
        verified,
        rejectionNote: verified ? null : (input.note ?? null),
        verifiedBy: ctx.userId,
      });
      await this.audit(
        tx,
        p,
        verified ? 'document_verified' : 'document_rejected',
        { docType: doc.docType, status: 'PENDING' },
        { docType: doc.docType, status: input.decision },
        input.note,
      );
    });
    return this.detail(ctx, id);
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------

  /** Visible (else 404), in a zone (else 409: move it into one first), and the action held there (404/403). */
  private async writable(
    ctx: AuthContext,
    id: string,
    action: 'edit' | 'status' | 'delete',
  ): Promise<PartnerRecord & { zoneId: string }> {
    const p = await this.deps.db.repo.find(ctx, id);
    if (!p) throw notFound();
    if (p.zoneId === null)
      throw new AppError('CONFLICT', 'Move the partner into a zone before changing them');
    assertCanWrite(ctx, `delivery:${action}`, p.zoneId);
    return { ...p, zoneId: p.zoneId };
  }

  private async reload(tx: PartnersTx, id: string): Promise<PartnerRecord> {
    const p = await tx.repo.get(id);
    if (!p) throw notFound();
    return p;
  }

  private audit(
    tx: PartnersTx,
    p: PartnerRecord,
    verb: string,
    before: unknown,
    after: unknown,
    note?: string,
  ): Promise<void> {
    return record(tx.audit, {
      module: 'delivery',
      action: `partner.${verb}` as AuditActionKey,
      entity: { type: 'partner', id: p.id, label: p.name, zoneId: p.zoneId },
      before,
      after,
      ...(note ? { note } : {}),
    });
  }

  /** What the audit trail keeps of a partner (contact masked, doc 50 redaction). */
  private auditView(p: PartnerRecord) {
    return {
      name: p.name,
      phone: p.phone ? maskPhone(p.phone) : null,
      email: p.email ? maskEmail(p.email) : null,
      vehicleType: p.vehicleType,
      vehicleNo: p.vehicleNo,
      area: p.area,
      zoneId: p.zoneId,
      status: p.status,
      verificationStatus: p.verificationStatus,
    };
  }

  private async capsOf(rows: readonly PartnerRecord[]): Promise<Map<string, number>> {
    const zones = [...new Set(rows.map((r) => r.zoneId).filter((z): z is string => z !== null))];
    const caps = await Promise.all(zones.map((z) => this.deps.maxConcurrentOrders(z)));
    return new Map(zones.map((z, i) => [z, caps[i] ?? 1]));
  }

  private toListItem(p: PartnerRecord, caps: Map<string, number>, now: Date): PartnerListItem {
    return {
      id: p.id,
      zone: p.zone,
      assignment: p.zoneAssignmentStatus,
      name: p.name,
      phone: p.phone ? maskPhone(p.phone) : null,
      email: p.email ? maskEmail(p.email) : null,
      vehicleType: p.vehicleType,
      vehicleNo: p.vehicleNo,
      area: p.area,
      status: p.status,
      verificationStatus: p.verificationStatus,
      isOnline: p.isOnline,
      forceOfflineUntil: iso(p.forceOfflineUntil),
      assignable: isAssignable(p, now),
      currentOrders: p.currentOrders,
      maxConcurrentOrders: p.zoneId ? (caps.get(p.zoneId) ?? null) : null,
      cashInHand: p.cashInHand,
      ratingAvg: p.ratingAvg === null ? null : Number(p.ratingAvg),
      deliveriesCount: p.deliveriesCount,
      source: p.source,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      version: p.version,
    };
  }

  private async toDetail(p: PartnerRecord): Promise<PartnerDetail> {
    const now = this.deps.clock();
    const [caps, docs, openOrders, required] = await Promise.all([
      this.capsOf([p]),
      this.deps.db.repo.documents(p.id),
      this.deps.db.repo.openOrders(p.id),
      p.zoneId
        ? this.deps.checklist.onboardingCatalogue('DELIVERY_PARTNER')
        : Promise.resolve(null),
    ]);
    const documents: PartnerDocument[] = docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      status: reviewOf(d),
      rejectionNote: d.rejectionNote,
      verifiedBy: d.verifier,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
    const checklist = required
      ? required.map((t) => {
          // documents are newest first: the first of a type is its current state
          const newest = documents.find((d) => d.docType === t.code);
          return {
            docType: t.code,
            label: t.label,
            mandatory: t.mandatory,
            state: newest ? newest.status : ('MISSING' as const),
          };
        })
      : null;
    return {
      ...this.toListItem(p, caps, now),
      verificationNote: p.verificationNote,
      verifiedAt: iso(p.verifiedAt),
      verifiedBy: p.verifier,
      sourceUpdatedAt: iso(p.sourceUpdatedAt),
      documents,
      checklist,
      openOrders: openOrders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        placedAt: o.placedAt.toISOString(),
      })),
    };
  }
}
