import type {
  AuditActionKey,
  HomemakerCreateInput,
  HomemakerDetail,
  HomemakerListItem,
  HomemakerUpdateInput,
  OpeningDay,
  PermissionKey,
  RestaurantCreateInput,
  RestaurantDetail,
  RestaurantListItem,
  RestaurantUpdateInput,
  VendorCounts,
  VendorDocument,
  VendorDocumentAttachInput,
  VendorDocumentType,
  VendorDocumentUrl,
  VendorDocumentVerifyInput,
  VendorListQuery,
  VendorModule,
  VendorMoveZoneInput,
  VendorStatusInput,
  VendorVerificationInput,
  ZoneServiceKind,
} from '@zoauro/shared';
import { maskEmail, maskPhone, record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { ObjectStorage } from '../../lib/storage';
import { assertStatusTransition, assertVerificationDecision, statusAction } from './vendor.state';
import { statusChangedRow, updatedRow } from './vendors.events';
import type {
  VendorDocumentRecord,
  VendorRecord,
  VendorsDatabase,
  VendorsTx,
  VendorWrite,
} from './vendors.repository';

// Restaurants (M06) and Home Food (M07) rules (doc 09, doc 10 section 4, D22, D26, D92, D97, D113, D120, D123). Ported
// from Chittra Priya's branch, rebuilt on the core: the route checks the module permission, this service checks the
// zone of the object (404 outside the actor's scope, 403 for a missing action), and every write is one transaction
// with its audit row and, for admin-owned fields, its outbox event.

export type CreateInput<M extends VendorModule> = M extends 'restaurants'
  ? RestaurantCreateInput
  : HomemakerCreateInput;
export type UpdateInput<M extends VendorModule> = M extends 'restaurants'
  ? RestaurantUpdateInput
  : HomemakerUpdateInput;
type ListItem = RestaurantListItem | HomemakerListItem;
type Detail = RestaurantDetail | HomemakerDetail;

/** D92 service of each module. */
const SERVICE_OF: Record<VendorModule, ZoneServiceKind> = {
  restaurants: 'RESTAURANTS',
  homemakers: 'HOME_FOOD',
};
const ENTITY_OF = { restaurants: 'restaurant', homemakers: 'homemaker' } as const;
/** D123: audited reveals per member and hour (doc 32). */
export const REVEALS_PER_HOUR = 30;

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');
const key = (module: VendorModule, action: string) => `${module}:${action}` as PermissionKey;

export interface VendorsDeps {
  db: VendorsDatabase;
  storage: ObjectStorage;
  /** the uploads module's gate for a fileKey */
  uploads: { assertUploaded(ctx: AuthContext, fileKey: string): Promise<unknown> };
  /** the zones module (D92): 409 ZONE_SERVICE_DISABLED when the service is off, 404 for a missing zone */
  services: { assertServiceEnabled(zoneId: string, service: ZoneServiceKind): Promise<void> };
  /** settings `onboarding.documents` for a zone (D97); HOME_FOOD null = not configured (D113) */
  checklist: {
    onboardingDocuments(
      zoneId: string,
    ): Promise<{ RESTAURANT: string[]; HOME_FOOD: string[] | null }>;
  };
  limiter: RateLimiter;
  clock: () => Date;
}

export class VendorsService {
  constructor(private readonly deps: VendorsDeps) {}

  // ---- reads ------------------------------------------------------------------------------------------------------

  async list(
    ctx: AuthContext,
    module: VendorModule,
    q: VendorListQuery,
  ): Promise<{
    data: ListItem[];
    meta: { page: number; pageSize: number; total: number; counts: VendorCounts };
  }> {
    const repo = this.deps.db.repo;
    const [{ rows, total }, counts] = await Promise.all([
      repo.list(ctx, module, q),
      repo.counts(ctx, module, q),
    ]);
    return {
      data: rows.map(listItem),
      meta: { page: q.page, pageSize: q.pageSize, total, counts },
    };
  }

  async detail(ctx: AuthContext, module: VendorModule, id: string): Promise<Detail> {
    const v = await this.deps.db.repo.find(ctx, module, id);
    if (!v) throw notFound();
    return this.toDetail(v);
  }

  /** D123: the unmasked phone and email, audited (no row = no data, D61) and rate-limited. */
  async reveal(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
  ): Promise<{ phone: string | null; email: string | null }> {
    const v = await this.deps.db.repo.find(ctx, module, id);
    if (!v) throw notFound();
    if (!ctx.isSuperAdmin && !(v.zoneId !== null && ctx.limitsByZone.get(v.zoneId)?.canReveal))
      throw forbidden();
    const hit = await this.deps.limiter.hit(`vendor-reveal:${ctx.userId}`, REVEALS_PER_HOUR, 3600);
    if (!hit.allowed)
      throw new AppError('RATE_LIMITED', 'Too many reveals. Try again later.', undefined, {
        'Retry-After': String(Math.max(1, hit.retryAfterSec)),
      });
    await this.deps.db.transaction((tx) =>
      this.audit(tx, v, 'contact_revealed', undefined, undefined),
    );
    return { phone: v.phone, email: v.email };
  }

  // ---- writes -----------------------------------------------------------------------------------------------------

  async create<M extends VendorModule>(
    ctx: AuthContext,
    module: M,
    input: CreateInput<M>,
  ): Promise<Detail> {
    assertCanWrite(ctx, key(module, 'add'), input.zoneId);
    if (input.commissionPct !== undefined && !ctx.isSuperAdmin) throw forbidden();
    if (!(await this.deps.db.repo.zoneRef(input.zoneId))) throw notFound();
    await this.deps.services.assertServiceEnabled(input.zoneId, SERVICE_OF[module]);
    const id = uuidv7();
    const v = await this.deps.db.transaction(async (tx) => {
      await tx.repo.insert(module, {
        ...writeOf(module, input),
        id,
        zoneId: input.zoneId,
        name: input.name,
        createdBy: ctx.userId,
      });
      const created = await this.reload(tx, module, id);
      await this.audit(tx, created, 'created', undefined, auditView(created));
      return created;
    });
    return this.toDetail(v);
  }

  async update<M extends VendorModule>(
    ctx: AuthContext,
    module: M,
    id: string,
    input: UpdateInput<M>,
  ): Promise<Detail> {
    const before = await this.writable(ctx, module, id, 'edit');
    if (input.commissionPct !== undefined && !ctx.isSuperAdmin) throw forbidden();
    const w = writeOf(module, input);
    const v = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(module, id);
      await tx.repo.update(module, id, w, ctx.userId);
      const after = await this.reload(tx, module, id);
      const commissionChanged = after.commissionPct !== before.commissionPct;
      const restBefore = withoutCommission(auditView(before));
      const restAfter = withoutCommission(auditView(after));
      await this.audit(tx, after, 'updated', restBefore, restAfter);
      if (commissionChanged) {
        await this.audit(
          tx,
          after,
          'commission_changed',
          { commissionPct: before.commissionPct },
          { commissionPct: after.commissionPct },
        );
        await tx.repo.insertOutbox([
          updatedRow(after, ctx.userId, this.deps.clock(), { commissionPct: after.commissionPct }),
        ]);
      }
      return after;
    });
    return this.toDetail(v);
  }

  async setStatus(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    input: VendorStatusInput,
  ): Promise<Detail> {
    const before = await this.writable(ctx, module, id, 'status');
    assertStatusTransition(before.status, before.verificationStatus, input.status);
    const v = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(module, id);
      const current = await this.reload(tx, module, id);
      assertStatusTransition(current.status, current.verificationStatus, input.status);
      await tx.repo.update(module, id, { status: input.status }, ctx.userId);
      const after = await this.reload(tx, module, id);
      await this.audit(
        tx,
        after,
        statusAction(input.status),
        { status: current.status },
        { status: after.status },
        input.reason,
      );
      await tx.repo.insertOutbox([statusChangedRow(after, ctx.userId, this.deps.clock())]);
      return after;
    });
    return this.toDetail(v);
  }

  async verify(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    input: VendorVerificationInput,
  ): Promise<Detail> {
    const before = await this.writable(ctx, module, id, 'status');
    assertVerificationDecision(before.verificationStatus, input.decision);
    const verified = input.decision === 'VERIFIED';
    const v = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(module, id);
      const current = await this.reload(tx, module, id);
      assertVerificationDecision(current.verificationStatus, input.decision);
      await tx.repo.update(
        module,
        id,
        {
          verificationStatus: input.decision,
          verificationNote: verified ? null : (input.note ?? null),
          verifiedAt: verified ? this.deps.clock() : null,
          verifiedBy: verified ? ctx.userId : null,
        },
        ctx.userId,
      );
      const after = await this.reload(tx, module, id);
      await this.audit(
        tx,
        after,
        verified ? 'verified' : 'rejected',
        { verificationStatus: current.verificationStatus },
        { verificationStatus: after.verificationStatus },
        input.note,
      );
      await tx.repo.insertOutbox([statusChangedRow(after, ctx.userId, this.deps.clock())]);
      return after;
    });
    return this.toDetail(v);
  }

  /** R-VEN-3: a Super Admin only (the route needs zones:edit). Also assigns an app sign-up that has no zone yet. */
  async moveZone(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    input: VendorMoveZoneInput,
  ): Promise<Detail> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const before = await this.deps.db.repo.find(ctx, module, id);
    if (!before) throw notFound();
    if (before.zoneId === input.zoneId)
      throw new AppError('CONFLICT', 'The vendor is already in this zone');
    const target = await this.deps.db.repo.zoneRef(input.zoneId);
    if (!target) throw notFound();
    const v = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(module, id);
      await tx.repo.update(
        module,
        id,
        { zoneId: target.id, zoneAssignmentStatus: 'ASSIGNED' },
        ctx.userId,
      );
      const after = await this.reload(tx, module, id);
      await this.audit(
        tx,
        after,
        'zone_moved',
        { zone: before.zone?.name ?? null },
        { zone: target.name },
        input.reason,
      );
      await tx.repo.insertOutbox([
        updatedRow(after, ctx.userId, this.deps.clock(), {
          zoneId: target.id,
          zoneName: target.name,
        }),
      ]);
      return after;
    });
    return this.toDetail(v);
  }

  /** Soft delete (doc 09 DELETE); an active vendor is deactivated first. */
  async remove(ctx: AuthContext, module: VendorModule, id: string): Promise<void> {
    const before = await this.writable(ctx, module, id, 'delete');
    if (before.status === 'ACTIVE')
      throw new AppError('INVALID_STATE_TRANSITION', 'Deactivate the vendor before deleting it');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(module, id);
      const current = await this.reload(tx, module, id);
      if (current.status === 'ACTIVE')
        throw new AppError('INVALID_STATE_TRANSITION', 'Deactivate the vendor before deleting it');
      await tx.repo.update(module, id, { deletedAt: this.deps.clock() }, ctx.userId);
      await this.audit(tx, current, 'deleted', auditView(current), undefined);
    });
  }

  // ---- documents (D97, D120) --------------------------------------------------------------------------------------

  async attachDocument(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    input: VendorDocumentAttachInput,
  ): Promise<Detail> {
    const v = await this.writable(ctx, module, id, 'edit');
    // the key names the vendor and its zone: a file uploaded for another vendor is not this vendor's document
    if (!input.fileKey.startsWith(`zone/${v.zoneId}/${v.id}/`))
      throw new AppError('VALIDATION_ERROR', 'The file was uploaded for another vendor', [
        { field: 'fileKey', issue: 'other_entity' },
      ]);
    await this.deps.uploads.assertUploaded(ctx, input.fileKey);
    await this.deps.db.transaction(async (tx) => {
      const docId = uuidv7();
      await tx.repo.insertDocument(module, {
        id: docId,
        vendorId: id,
        docType: input.docType,
        fileKey: input.fileKey,
        createdBy: ctx.userId,
      });
      await this.audit(tx, v, 'document_added', undefined, {
        docType: input.docType,
        documentId: docId,
      });
    });
    return this.detail(ctx, module, id);
  }

  /** A 300 s signed read link; every link is an audited view (D61: no audit row, no link). */
  async documentUrl(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    docId: string,
  ): Promise<VendorDocumentUrl> {
    const v = await this.deps.db.repo.find(ctx, module, id);
    if (!v) throw notFound();
    const doc = await this.deps.db.repo.document(module, id, docId);
    if (!doc) throw notFound();
    await this.deps.db.transaction((tx) =>
      this.audit(tx, v, 'document_viewed', undefined, undefined, `${doc.docType} ${doc.id}`),
    );
    return { url: await this.deps.storage.presignRead(doc.fileKey), expiresInSec: 300 };
  }

  async verifyDocument(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    docId: string,
    input: VendorDocumentVerifyInput,
  ): Promise<Detail> {
    const v = await this.writable(ctx, module, id, 'status');
    const doc = await this.deps.db.repo.document(module, id, docId);
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
        v,
        verified ? 'document_verified' : 'document_rejected',
        { docType: doc.docType, status: 'PENDING' },
        { docType: doc.docType, status: input.decision },
        input.note,
      );
    });
    return this.detail(ctx, module, id);
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------

  /** Visible (else 404), in a zone (else 409: assign it first), and the action held in that zone (404/403). */
  private async writable(
    ctx: AuthContext,
    module: VendorModule,
    id: string,
    action: 'edit' | 'status' | 'delete',
  ): Promise<VendorRecord & { zoneId: string }> {
    const v = await this.deps.db.repo.find(ctx, module, id);
    if (!v) throw notFound();
    if (v.zoneId === null)
      throw new AppError('CONFLICT', 'Move the vendor into a zone before changing it');
    assertCanWrite(ctx, key(module, action), v.zoneId);
    return { ...v, zoneId: v.zoneId };
  }

  private async reload(tx: VendorsTx, module: VendorModule, id: string): Promise<VendorRecord> {
    const v = await tx.repo.get(module, id);
    if (!v) throw notFound();
    return v;
  }

  private audit(
    tx: VendorsTx,
    v: VendorRecord,
    verb: string,
    before: unknown,
    after: unknown,
    note?: string,
  ): Promise<void> {
    const entity = ENTITY_OF[v.module];
    return record(tx.audit, {
      module: v.module,
      action: `${entity}.${verb}` as AuditActionKey,
      entity: { type: entity, id: v.id, label: v.name, zoneId: v.zoneId },
      before,
      after,
      ...(note ? { note } : {}),
    });
  }

  private async toDetail(v: VendorRecord): Promise<Detail> {
    const docs = await this.deps.db.repo.documents(v.module, v.id);
    const documents = docs.map(documentDto);
    const checklist = v.zoneId === null ? null : await this.checklistFor(v, docs);
    const base = {
      ...listItem(v),
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      commissionPct: v.commissionPct,
      minOrderPaise: v.minOrder,
      fssaiNo: v.fssaiNo,
      openingHours: openingHoursOf(v.openingHours),
      verificationNote: v.verificationNote,
      verifiedAt: v.verifiedAt?.toISOString() ?? null,
      verifiedBy: v.verifier,
      sourceUpdatedAt: v.sourceUpdatedAt?.toISOString() ?? null,
      documents,
      checklist,
    };
    return v.module === 'restaurants'
      ? ({ ...base, gstNo: v.gstNo, hasLogo: v.hasImage } as RestaurantDetail)
      : ({ ...base, experienceYears: v.experienceYears, hasPhoto: v.hasImage } as HomemakerDetail);
  }

  /** D97 checklist: each required type and the state of its newest document; null when not configured (D113). */
  private async checklistFor(
    v: VendorRecord & { zoneId: string | null },
    docs: VendorDocumentRecord[],
  ): Promise<Detail['checklist']> {
    if (v.zoneId === null) return null;
    const lists = await this.deps.checklist.onboardingDocuments(v.zoneId);
    const required = v.module === 'restaurants' ? lists.RESTAURANT : lists.HOME_FOOD;
    if (required === null) return null;
    return required
      .filter((t): t is VendorDocumentType => t !== 'DRIVING_LICENCE' && t !== 'VEHICLE_RC')
      .map((docType) => {
        const newest = docs.find((d) => d.docType === docType); // documents() is newest first
        return { docType, state: newest ? reviewOf(newest) : 'MISSING' };
      });
  }
}

// ---- mapping ------------------------------------------------------------------------------------------------------

function listItem(v: VendorRecord): ListItem {
  const base = {
    id: v.id,
    zone: v.zone,
    assignment: v.assignment,
    name: v.name,
    phone: v.phone === null ? null : maskPhone(v.phone),
    email: v.email === null ? null : maskEmail(v.email),
    area: v.area,
    status: v.status,
    verificationStatus: v.verificationStatus,
    isOpen: v.isOpen,
    source: v.source,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
  return v.module === 'restaurants'
    ? { ...base, kind: v.kind, ownerName: v.ownerName, cuisineTags: v.tags }
    : {
        ...base,
        specialityTags: v.tags,
        foodCategory: v.foodCategory,
        isAvailable: v.isAvailable,
        dailyCapacity: v.dailyCapacity,
      };
}

function reviewOf(d: VendorDocumentRecord): VendorDocument['status'] {
  if (d.verified) return 'VERIFIED';
  return d.rejectionNote !== null ? 'REJECTED' : 'PENDING';
}

function documentDto(d: VendorDocumentRecord): VendorDocument {
  return {
    id: d.id,
    docType: d.docType,
    status: reviewOf(d),
    rejectionNote: d.rejectionNote,
    verifiedBy: d.verifier,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function openingHoursOf(raw: unknown): Detail['openingHours'] {
  if (!Array.isArray(raw)) return null;
  return (raw as OpeningDay[]).map((d) => ({
    day: d.day,
    isOpen: d.isOpen,
    opens: d.opens ?? null,
    closes: d.closes ?? null,
  }));
}

/** What the audit trail keeps of a vendor (phone and email are masked by the audit redaction policy). */
function auditView(v: VendorRecord) {
  return {
    name: v.name,
    phone: v.phone,
    email: v.email,
    address: v.address,
    area: v.area,
    lat: v.lat,
    lng: v.lng,
    tags: v.tags,
    commissionPct: v.commissionPct,
    minOrderPaise: v.minOrder,
    fssaiNo: v.fssaiNo,
    openingHours: v.openingHours,
    ...(v.module === 'restaurants'
      ? { kind: v.kind, ownerName: v.ownerName, gstNo: v.gstNo }
      : {
          foodCategory: v.foodCategory,
          experienceYears: v.experienceYears,
          isAvailable: v.isAvailable,
          dailyCapacity: v.dailyCapacity,
        }),
  };
}

/** The profile part of the audit view: commission changes get their own audit row. */
function withoutCommission(
  v: ReturnType<typeof auditView>,
): Omit<ReturnType<typeof auditView>, 'commissionPct'> {
  const out: Partial<ReturnType<typeof auditView>> = { ...v };
  delete out.commissionPct;
  return out as Omit<ReturnType<typeof auditView>, 'commissionPct'>;
}

/** A create or update body as repository fields; only the fields present are written. */
function writeOf(
  module: VendorModule,
  i:
    | Partial<RestaurantCreateInput & HomemakerCreateInput>
    | RestaurantUpdateInput
    | HomemakerUpdateInput,
): VendorWrite {
  const src = i as Partial<
    Omit<RestaurantUpdateInput & HomemakerUpdateInput, 'cuisineTags' | 'specialityTags'>
  > & { cuisineTags?: string[]; specialityTags?: string[]; minOrderPaise?: number };
  const w: VendorWrite = {};
  if (src.name !== undefined) w.name = src.name;
  if (src.phone !== undefined) w.phone = src.phone;
  if (src.email !== undefined) w.email = src.email;
  if (src.address !== undefined) w.address = src.address;
  if (src.area !== undefined) w.area = src.area;
  if (src.lat !== undefined) w.lat = src.lat;
  if (src.lng !== undefined) w.lng = src.lng;
  if (src.commissionPct !== undefined) w.commissionPct = src.commissionPct;
  if (src.minOrderPaise !== undefined) w.minOrder = src.minOrderPaise;
  if (src.fssaiNo !== undefined) w.fssaiNo = src.fssaiNo;
  if (src.openingHours !== undefined) w.openingHours = src.openingHours;
  if (module === 'restaurants') {
    if (src.cuisineTags !== undefined) w.tags = src.cuisineTags;
    if (src.kind !== undefined) w.kind = src.kind;
    if (src.ownerName !== undefined) w.ownerName = src.ownerName;
    if (src.gstNo !== undefined) w.gstNo = src.gstNo;
  } else {
    if (src.specialityTags !== undefined) w.tags = src.specialityTags;
    if (src.foodCategory !== undefined) w.foodCategory = src.foodCategory;
    if (src.experienceYears !== undefined) w.experienceYears = src.experienceYears;
    if (src.isAvailable !== undefined) w.isAvailable = src.isAvailable;
    if (src.dailyCapacity !== undefined) w.dailyCapacity = src.dailyCapacity;
  }
  return w;
}
