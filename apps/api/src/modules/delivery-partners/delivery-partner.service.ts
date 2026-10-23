import type { VendorDocument as VendorDocumentModel } from '@prisma/client';
import type {
  DeliveryPartnerCreateInput,
  DeliveryPartnerDetail,
  DeliveryPartnerForceOfflineInput,
  DeliveryPartnerMoveZoneInput,
  DeliveryPartnerReveal,
  DeliveryPartnerStatusInput,
  DeliveryPartnerUpdateInput,
  DeliveryPartnerVerificationInput,
  DeliveryPartner as DeliveryPartnerDto,
  ListDeliveryPartnersQuery,
  ListDeliveryPartnersResponse,
  VendorActivity,
  VendorDocument,
  VendorDocumentUploadInput,
  VendorDocumentUrl,
  VendorDocumentVerifyInput,
} from '@zoauro/shared';
import { requestedPartnerZoneIds } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { maskPhone } from '../../lib/contact-mask';
import { PRESIGN_READ_TTL_SEC, presignRead } from '../../lib/storage';
import { recordAudit } from '../audit/audit.service';
import { assertUploadedObject, parseFileKey } from '../uploads/uploads.service';
import * as repo from './delivery-partner.repository';
import {
  assertStatusTransition,
  assertVerificationDecision,
  isOnDuty,
} from './delivery-partner.state';

/**
 * M10 Delivery Partners service (doc 09 `/delivery-partners`, doc 10 §5
 * state machine, doc 20/22 screen and form, doc 34 SA-3.2).
 *
 * Availability (`isOnline`, `forceOfflineUntil`) and verification/status stay
 * separate (doc 10 §5, doc 44 §1): force offline never touches status and
 * verification never touches availability.
 */

/** Actor of the write (doc 07 §6: every write carries its audit row). */
export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

/**
 * Phone arrives masked here (D26 / doc 15): lists and profile rows carry the
 * masked number; the full value leaves the API only through the audited
 * detail/reveal (D131).
 */
function serializePartner(row: repo.PartnerRowWithZone): DeliveryPartnerDto {
  return {
    id: row.id,
    zoneId: row.zoneId,
    zone: row.zone,
    name: row.name,
    phone: maskPhone(row.phone),
    vehicleType: row.vehicleType,
    vehicleNo: row.vehicleNo,
    area: row.area,
    status: row.status,
    isOnline: row.isOnline,
    forceOfflineUntil: row.forceOfflineUntil ? row.forceOfflineUntil.toISOString() : null,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    currentOrders: row.currentOrders,
    cashInHand: row.cashInHand,
    ratingAvg: row.ratingAvg,
    deliveriesCount: row.deliveriesCount,
    /* Task columns (Own Delivery Partners page) — seeded in dev/test, then
     * maintained by the orders pipeline once M11 lands. */
    ordersAssigned: row.ordersAssigned,
    failedDeliveries: row.failedDeliveries,
    avgDeliveryMinutes: row.avgDeliveryMinutes,
    onTimePct: row.onTimePct,
    earningsPaise: row.earningsPaise,
    settlementStatus: row.settlementStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Scope (doc 09 §zone scope, doc 36)
 * ------------------------------------------------------------------ */

/**
 * Effective zone scope for a list request. Super Admin: any zone or none
 * (= all). Unknown `?zoneId` → 404 `ZONE_NOT_FOUND` (doc 09). Zonal Admin
 * requests never reach here (delivery-partner.scope.ts 403s first) until
 * SA-1.7 resolves assignments, then requested ∩ assigned per doc 36 §1.
 */
async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

/** Zone target for a create write, with its status (doc 36 §3). */
async function requireWritableZoneRef(zoneId: string): Promise<repo.ZoneRef> {
  const zone = await repo.findZoneForWrite(zoneId);
  if (!zone) throw errors.zoneNotFound();
  if (zone.status === 'INACTIVE') {
    throw errors.conflict('This zone is deactivated — delivery partners cannot be added to it');
  }
  return { id: zone.id, name: zone.name, city: zone.city };
}

/**
 * One partner inside the zone scope — outside it the record is 404, not 403
 * (doc 09 / doc 36 §1). `zoneIds` is `null` (every zone) while only Super
 * Admins can call these routes; SA-1.7 passes the member's effective zones.
 */
async function requirePartner(
  id: string,
  zoneIds: string[] | null,
): Promise<repo.PartnerRowWithZone> {
  const row = await repo.findPartner(id, zoneIds);
  if (!row) throw errors.notFound('Delivery partner not found');
  return row;
}

/** Digits-compare duplicate guard (doc 22 form row "phone (unique)"). */
async function assertNoDuplicatePhone(phone: string): Promise<void> {
  const existing = await repo.findPartnerByPhone(phone);
  if (existing) {
    throw errors.conflict(
      `A delivery partner with this phone number already exists (${existing.name}).`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listDeliveryPartners(
  query: ListDeliveryPartnersQuery,
): Promise<ListDeliveryPartnersResponse> {
  const zoneIds = await resolveZoneScope(requestedPartnerZoneIds(query));

  const [page, counts, facets, online, onTimeAvg] = await Promise.all([
    repo.listPartners({ zoneIds, query }),
    repo.countPartners(zoneIds),
    repo.partnerFacets(zoneIds),
    repo.onlineStates(zoneIds),
    repo.avgOnTimePct(zoneIds),
  ]);
  const zones = await repo.findZones(facets.zoneIds);
  const now = new Date();

  return {
    data: page.rows.map(serializePartner),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts: {
        ...counts,
        onDuty: online.filter((state) => isOnDuty(state, now)).length,
        onTimePctAvg: onTimeAvg,
      },
      facets: { areas: facets.areas, vehicleTypes: facets.vehicleTypes, zones },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Writes (transaction + audit row, doc 07 §6)
 * ------------------------------------------------------------------ */

function auditEntry(
  ctx: ActorContext,
  id: string,
  zoneId: string,
  opts: { action: string; before?: unknown; after: unknown },
) {
  return {
    actorId: ctx.auth.userId,
    zoneId,
    module: 'delivery-partners',
    action: opts.action,
    entityType: 'delivery-partner',
    entityId: id,
    before: opts.before,
    after: opts.after,
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  };
}

/** POST /delivery-partners (doc 09, `delivery:add`) — doc 22 form row. */
export async function createDeliveryPartner(
  ctx: ActorContext,
  input: DeliveryPartnerCreateInput,
): Promise<DeliveryPartnerDto> {
  const zone = await requireWritableZoneRef(input.zoneId);
  await assertNoDuplicatePhone(input.phone);

  return prisma.$transaction(async (tx) => {
    const partner = await repo.createPartner(tx, {
      zoneId: input.zoneId,
      name: input.name,
      phone: input.phone,
      vehicleType: input.vehicleType,
      vehicleNo: input.vehicleNo,
      area: input.area,
      status: input.status,
    });
    const dto = serializePartner({ ...partner, zone });
    await recordAudit(
      tx,
      auditEntry(ctx, partner.id, zone.id, { action: 'delivery-partners.create', after: dto }),
    );
    return dto;
  });
}

/** PATCH /delivery-partners/{id} (doc 09, `delivery:edit`) — intake `PartnerPatch` fields. */
export async function updateDeliveryPartner(
  ctx: ActorContext,
  id: string,
  input: DeliveryPartnerUpdateInput,
): Promise<DeliveryPartnerDto> {
  const before = await requirePartner(id, null);
  const beforeDto = serializePartner(before);

  return prisma.$transaction(async (tx) => {
    const partner = await repo.updatePartner(tx, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.vehicleType !== undefined ? { vehicleType: input.vehicleType } : {}),
      ...(input.vehicleNo !== undefined ? { vehicleNo: input.vehicleNo } : {}),
      ...(input.area !== undefined ? { area: input.area } : {}),
    });
    const after = serializePartner({ ...partner, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, id, before.zoneId, {
        action: 'delivery-partners.update',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/**
 * POST /delivery-partners/{id}/verification (doc 09, `delivery:status`) —
 * doc 10 §5 transition, mirroring the vendor review flow: VERIFIED moves the
 * partner to VERIFIED and stamps `verified_at`; REJECTED keeps
 * PENDING_VERIFICATION (rejected partners stay pending) and stores the
 * required note.
 *
 * `delivery_partners` has no `verification_note` column in doc 08, so the
 * note is persisted on the audit row (`delivery-partners.verification`,
 * afterJson.note) — the append-only trail doc 07 §6 already guarantees. A
 * visible column needs an owner decision + doc 08 amendment (handoff gap).
 */
export async function setDeliveryPartnerVerification(
  ctx: ActorContext,
  id: string,
  input: DeliveryPartnerVerificationInput,
): Promise<DeliveryPartnerDto> {
  const before = await requirePartner(id, null);
  const beforeDto = serializePartner(before);
  assertVerificationDecision(before.status, input.decision);

  const data =
    input.decision === 'VERIFIED'
      ? { status: 'VERIFIED' as const, verifiedAt: new Date() }
      : { status: 'PENDING_VERIFICATION' as const, verifiedAt: null };

  return prisma.$transaction(async (tx) => {
    const partner = await repo.updatePartner(tx, id, data);
    const after = serializePartner({ ...partner, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, id, before.zoneId, {
        action: 'delivery-partners.verification',
        before: beforeDto,
        after: {
          ...after,
          decision: input.decision,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      }),
    );
    return after;
  });
}

/**
 * POST /delivery-partners/{id}/force-offline (doc 09, `delivery:status`,
 * doc 44 §1 / doc 43 `partner.force_offline`): the partner goes offline
 * immediately; `until` (optional) records when the force window ends, omitting
 * it forces offline with no automatic end time (doc 08 v2.0 column). Status
 * and verification are untouched — availability only.
 */
export async function forceDeliveryPartnerOffline(
  ctx: ActorContext,
  id: string,
  input: DeliveryPartnerForceOfflineInput,
): Promise<DeliveryPartnerDto> {
  const before = await requirePartner(id, null);
  const beforeDto = serializePartner(before);

  let until: Date | null = null;
  if (input.until !== undefined) {
    until = new Date(input.until);
    if (until.getTime() <= Date.now()) {
      throw errors.validation(
        [{ field: 'until', issue: 'Choose a time in the future' }],
        'Choose a time in the future',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const partner = await repo.updatePartner(tx, id, {
      isOnline: false,
      forceOfflineUntil: until,
    });
    const after = serializePartner({ ...partner, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, id, before.zoneId, {
        action: 'delivery-partners.force-offline',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/* ------------------------------------------------------------------ *
 * Detail, status and reveal (D131 — vendor/customer mirrors)
 * ------------------------------------------------------------------ */

function toDocument(doc: VendorDocumentModel): VendorDocument {
  return {
    id: doc.id,
    docType: doc.docType,
    fileKey: doc.fileKey,
    verified: doc.verified,
    verifiedBy: doc.verifiedBy,
    rejectionNote: doc.rejectionNote,
    expiresOn: doc.expiresOn ? doc.expiresOn.toISOString().slice(0, 10) : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toActivity(entry: {
  id: string;
  action: string;
  actorName: string;
  createdAt: Date;
}): VendorActivity {
  return {
    id: entry.id,
    action: entry.action,
    actorName: entry.actorName,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * GET /delivery-partners/{id} (D131): the partner plus its `vendor_documents`
 * rows (vendorType DELIVERY_PARTNER) and audit trail, vendor-detail shape.
 * Unlike the vendor detail, the phone stays masked here (D26: "reveal is an
 * audited call") — partners have a dedicated audited reveal endpoint, so the
 * full number leaves the API only through `revealDeliveryPartner`.
 */
export async function getDeliveryPartnerDetail(id: string): Promise<DeliveryPartnerDetail> {
  const row = await requirePartner(id, null);
  const [documents, activity] = await Promise.all([repo.listDocuments(id), repo.listActivity(id)]);
  return {
    ...serializePartner(row),
    documents: documents.map(toDocument),
    activity: activity.map(toActivity),
  };
}

/**
 * GET /delivery-partners/{id}/reveal (D26) — the only unmask path outside the
 * detail view. Audited before the real phone leaves the API; the payload
 * itself stays out of the audit log.
 */
export async function revealDeliveryPartner(
  ctx: ActorContext,
  id: string,
): Promise<DeliveryPartnerReveal> {
  const row = await requirePartner(id, null);
  await recordAudit(
    prisma,
    auditEntry(ctx, id, row.zoneId, {
      action: 'delivery-partners.reveal',
      after: { revealed: ['phone'] },
    }),
  );
  return { phone: row.phone };
}

/**
 * POST /delivery-partners/{id}/status (D131 — vendor status mirror): doc 10
 * §5 transitions between ACTIVE, INACTIVE and SUSPENDED, validated by the
 * pure state machine. The model has no version column, so no optimistic
 * version check applies (doc 08).
 */
export async function changeDeliveryPartnerStatus(
  ctx: ActorContext,
  id: string,
  input: DeliveryPartnerStatusInput,
): Promise<DeliveryPartnerDto> {
  const before = await requirePartner(id, null);
  const beforeDto = serializePartner(before);
  assertStatusTransition(before.status, input.status);

  return prisma.$transaction(async (tx) => {
    const partner = await repo.updatePartner(tx, id, { status: input.status });
    const after = serializePartner({ ...partner, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, id, before.zoneId, {
        action: 'delivery-partners.status',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/**
 * POST /delivery-partners/{id}/move-zone (D131 — vendor move-zone mirror,
 * Super Admin + recent re-auth). Deactivated zones accept no partners
 * (doc 36 §3, 409 CONFLICT — module convention from create); an unknown zone
 * is 404 ZONE_NOT_FOUND; the same zone is 409 CONFLICT (vendor convention).
 * No outbox event (D125: audit only).
 */
export async function moveDeliveryPartnerZone(
  ctx: ActorContext,
  id: string,
  input: DeliveryPartnerMoveZoneInput,
): Promise<DeliveryPartnerDto> {
  const before = await requirePartner(id, null);
  const beforeDto = serializePartner(before);
  if (before.zoneId === input.zoneId) {
    throw errors.conflict('Partner already belongs to this zone');
  }
  const zone = await requireWritableZoneRef(input.zoneId);
  // D131: open-orders refusal activates at M11 (doc 32 dependency); vacuously true today

  return prisma.$transaction(async (tx) => {
    const partner = await repo.updatePartner(tx, id, { zoneId: input.zoneId });
    const after = serializePartner({ ...partner, zone });
    await recordAudit(
      tx,
      auditEntry(ctx, id, input.zoneId, {
        action: 'delivery-partners.move-zone',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/**
 * DELETE /delivery-partners/{id} (D131 — Super Admin + recent re-auth). An
 * ACTIVE partner must be deactivated first (409 CONFLICT, vendor delete
 * convention). Soft delete only — the model has `deleted_at` (doc 08).
 */
export async function removeDeliveryPartner(
  ctx: ActorContext,
  id: string,
): Promise<{ id: string }> {
  const before = await requirePartner(id, null);
  if (before.status === 'ACTIVE') {
    throw errors.conflict('Partner must not be ACTIVE');
  }
  // D131: open-orders refusal activates at M11 (doc 32 dependency); vacuously true today
  const beforeDto = serializePartner(before);

  await prisma.$transaction(async (tx) => {
    await repo.updatePartner(tx, id, { deletedAt: new Date() });
    await recordAudit(
      tx,
      auditEntry(ctx, id, before.zoneId, {
        action: 'delivery-partners.delete',
        before: beforeDto,
        after: { id, deletedAt: true },
      }),
    );
  });
  return { id };
}

/* ------------------------------------------------------------------ *
 * Documents (D131 — vendor document mirror; vendor_documents rows with
 * vendorType DELIVERY_PARTNER; doc 09 + doc 11 upload flow)
 * ------------------------------------------------------------------ */

/** The key must belong to this very partner in this very zone (else 404). */
async function requireOwnedFileKey(row: repo.PartnerRowWithZone, fileKey: string): Promise<void> {
  const parsed = parseFileKey(fileKey);
  if (!parsed) {
    throw errors.validation([{ field: 'fileKey', issue: 'Invalid file key' }], 'Invalid file key');
  }
  if (parsed.entityId !== row.id || parsed.zoneId !== row.zoneId) {
    throw errors.notFound('Delivery partner not found');
  }
  // Full gate: object exists, stored type/size allow-listed, content sniffed.
  await assertUploadedObject(fileKey);
}

/** POST /delivery-partners/{id}/documents — attach a confirmed upload. */
export async function addDeliveryPartnerDocument(
  ctx: ActorContext,
  id: string,
  input: VendorDocumentUploadInput,
): Promise<VendorDocument> {
  const row = await requirePartner(id, null);
  await requireOwnedFileKey(row, input.fileKey);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await repo.createDocument(tx, {
      vendorId: id,
      docType: input.docType,
      fileKey: input.fileKey,
    });
    await recordAudit(
      tx,
      auditEntry(ctx, id, row.zoneId, {
        action: 'delivery-partners.document.upload',
        after: { documentId: created.id, docType: created.docType, fileKey: created.fileKey },
      }),
    );
    return created;
  });
  return toDocument(doc);
}

/**
 * GET /delivery-partners/{id}/documents/{documentId}/url — short-lived signed
 * read (doc 11); every download is audited (doc 15), the URL itself never is.
 */
export async function getDeliveryPartnerDocumentUrl(
  ctx: ActorContext,
  id: string,
  documentId: string,
): Promise<VendorDocumentUrl> {
  const row = await requirePartner(id, null);
  const doc = await repo.findDocument(id, documentId);
  if (!doc) throw errors.notFound('Document not found');

  const url = await presignRead(doc.fileKey);
  await recordAudit(prisma, {
    actorId: ctx.auth.userId,
    zoneId: row.zoneId,
    module: 'delivery-partners',
    action: 'delivery-partners.document.download',
    entityType: 'delivery-partner',
    entityId: id,
    after: { documentId: doc.id, docType: doc.docType, fileKey: doc.fileKey },
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  });
  return { url, expiresInSec: PRESIGN_READ_TTL_SEC };
}

/** POST /delivery-partners/{id}/documents/{documentId}/verify — per-document review. */
export async function setDeliveryPartnerDocumentVerification(
  ctx: ActorContext,
  id: string,
  documentId: string,
  input: VendorDocumentVerifyInput,
): Promise<VendorDocument> {
  const row = await requirePartner(id, null);
  const before = await repo.findDocument(id, documentId);
  if (!before) throw errors.notFound('Document not found');

  const data =
    input.decision === 'VERIFIED'
      ? { verified: true, verifiedBy: ctx.auth.userId, rejectionNote: null }
      : { verified: false, verifiedBy: null, rejectionNote: input.note ?? null };

  const doc = await prisma.$transaction(async (tx) => {
    const updated = await repo.updateDocument(tx, documentId, data);
    await recordAudit(
      tx,
      auditEntry(ctx, id, row.zoneId, {
        action: `delivery-partners.document.${input.decision === 'VERIFIED' ? 'verify' : 'reject'}`,
        before: toDocument(before),
        after: toDocument(updated),
      }),
    );
    return updated;
  });
  return toDocument(doc);
}
