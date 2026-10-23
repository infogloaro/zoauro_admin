import type { Prisma, VendorDocument as VendorDocumentModel } from '@prisma/client';
import type {
  HomemakerCreateInput,
  Homemaker as HomemakerDto,
  HomemakerUpdateInput,
  ListVendorsQuery,
  ListVendorsResponse,
  OpeningDayKey,
  RestaurantCreateInput,
  Restaurant as RestaurantDto,
  RestaurantUpdateInput,
  VendorActivity,
  VendorBulkStatusInput,
  VendorBulkStatusResponse,
  VendorDetail,
  VendorDocument,
  VendorDocumentUploadInput,
  VendorDocumentUrl,
  VendorDocumentVerifyInput,
  VendorKind,
  VendorStatusInput,
  VendorVerificationInput,
} from '@zoauro/shared';
import { OPENING_DAYS, requestedZoneIds } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { PRESIGN_READ_TTL_SEC, presignRead } from '../../lib/storage';
import { recordAudit } from '../audit/audit.service';
import { assertUploadedObject, parseFileKey } from '../uploads/uploads.service';
import * as repo from './vendor.repository';
import { assertStatusTransition, assertVerificationDecision } from './vendor.state';
import type {
  HomemakerRowWithZone,
  RestaurantRowWithZone,
  VendorRowWithZone,
  ZoneRef,
} from './vendor.types';

/** Weekly schedule as it leaves the API (`openingDayOutputSchema`). */
type OpeningHoursOutput = NonNullable<RestaurantDto['openingHours']>;

/** Actor of the write (doc 07 §6: every write carries its audit row). */
export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

export function auditModule(kind: VendorKind): 'restaurants' | 'homemakers' {
  return kind === 'restaurant' ? 'restaurants' : 'homemakers';
}

export function entityType(kind: VendorKind): 'restaurant' | 'homemaker' {
  return kind === 'restaurant' ? 'restaurant' : 'homemaker';
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

const OPENING_DAY_KEYS = new Set<string>(OPENING_DAYS);

/** `opening_hours_json` is untrusted JSON — normalise it, never echo raw. */
function serializeOpeningHours(value: Prisma.JsonValue): OpeningHoursOutput | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const days: OpeningHoursOutput = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const day = entry as Record<string, unknown>;
    if (typeof day.day !== 'string' || !OPENING_DAY_KEYS.has(day.day)) return null;
    if (typeof day.isOpen !== 'boolean') return null;
    days.push({
      day: day.day as OpeningDayKey,
      isOpen: day.isOpen,
      opens: typeof day.opens === 'string' ? day.opens : null,
      closes: typeof day.closes === 'string' ? day.closes : null,
    });
  }
  return days;
}

export function serializeRestaurant(row: RestaurantRowWithZone): RestaurantDto {
  return {
    kind: 'restaurant',
    id: row.id,
    zoneId: row.zoneId,
    zone: row.zone,
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    cuisineTags: row.cuisineTags,
    commissionPct: row.commissionPct,
    minOrder: row.minOrder,
    gstNo: row.gstNo,
    fssaiNo: row.fssaiNo,
    logoKey: row.logoKey,
    openingHours: serializeOpeningHours(row.openingHoursJson),
    status: row.status,
    verificationStatus: row.verificationStatus,
    verificationNote: row.verificationNote,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    verifiedBy: row.verifiedBy,
    reviewDueAt: row.reviewDueAt ? row.reviewDueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeHomemaker(row: HomemakerRowWithZone): HomemakerDto {
  return {
    kind: 'homemaker',
    id: row.id,
    zoneId: row.zoneId,
    zone: row.zone,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    specialityTags: row.specialityTags,
    foodCategory: row.foodCategory,
    experienceYears: row.experienceYears,
    isAvailable: row.isAvailable,
    dailyCapacity: row.dailyCapacity,
    commissionPct: row.commissionPct,
    minOrder: row.minOrder,
    fssaiNo: row.fssaiNo,
    photoKey: row.photoKey,
    openingHours: serializeOpeningHours(row.openingHoursJson),
    status: row.status,
    verificationStatus: row.verificationStatus,
    verificationNote: row.verificationNote,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    verifiedBy: row.verifiedBy,
    reviewDueAt: row.reviewDueAt ? row.reviewDueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeVendor(row: VendorRowWithZone): RestaurantDto | HomemakerDto {
  return 'foodCategory' in row ? serializeHomemaker(row) : serializeRestaurant(row);
}

/**
 * Doc 15 §privacy / D26: lists mask phone and email; the detail view keeps
 * revealing them in full, so only `listVendors` wraps its rows with this.
 */
export function maskPhone(value: string): string {
  const plus = value.startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(Math.max(digits.length, 1));
  const stars = '*'.repeat(Math.max(1, digits.length - 6));
  return `${plus ? '+' : ''}${digits.slice(0, 2)}${stars}${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '***';
  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}

function maskContact<T extends { phone: string; email: string | null }>(dto: T): T {
  return {
    ...dto,
    phone: maskPhone(dto.phone),
    email: dto.email === null ? null : maskEmail(dto.email),
  };
}

function serializeWithZone(vendor: repo.VendorRow, zone: ZoneRef): RestaurantDto | HomemakerDto {
  if ('foodCategory' in vendor) return serializeHomemaker({ ...vendor, zone });
  return serializeRestaurant({ ...vendor, zone });
}

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

/* ------------------------------------------------------------------ *
 * Scope (doc 09 §zone scope, doc 36)
 * ------------------------------------------------------------------ */

/**
 * Effective zone scope for this request. Super Admin: any zone or none (= all).
 * When SA-1.7 lands, intersect with the member's assignments and answer 404
 * `ZONE_NOT_FOUND` for zones outside them (doc 09, doc 36 §1).
 */
export async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

/**
 * Zone target for a write. Deactivated zones keep read access to their
 * history but accept no new vendors (doc 36 §3), so create and move-zone
 * answer 409 CONFLICT instead of silently associating the record.
 */
async function requireWritableZoneRef(zoneId: string): Promise<ZoneRef> {
  const zone = await repo.findZoneForWrite(zoneId);
  if (!zone) throw errors.zoneNotFound();
  if (zone.status === 'INACTIVE') {
    throw errors.conflict('This zone is deactivated — vendors cannot be added to it');
  }
  return { id: zone.id, name: zone.name, city: zone.city };
}

async function requireRow(kind: VendorKind, id: string): Promise<VendorRowWithZone> {
  const row = await repo.findVendor(kind, id);
  if (!row) throw errors.notFound('Vendor not found');
  return row;
}

/**
 * Duplicate submissions: one phone per vendor per zone (digits compared, so
 * +91/spacing variants of the same number count as the same vendor). Answer
 * 409 CONFLICT so the form can toast instead of silently creating a twin.
 */
async function assertNoDuplicatePhone(
  kind: VendorKind,
  zoneId: string,
  phone: string,
  excludeId: string | null,
): Promise<void> {
  const existing = await repo.findVendorByZonePhone(kind, zoneId, phone, excludeId ?? undefined);
  if (existing) {
    throw errors.conflict(
      `${kind === 'restaurant' ? 'A restaurant' : 'A home food provider'} with this phone number already exists in this zone (${existing.name}).`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listVendors(
  kind: VendorKind,
  query: ListVendorsQuery,
): Promise<ListVendorsResponse> {
  const zoneIds = await resolveZoneScope(requestedZoneIds(query));

  const [page, counts, facets] = await Promise.all([
    repo.listVendors(kind, { zoneIds, query }),
    repo.countVendors(kind, zoneIds),
    repo.vendorFacets(kind, zoneIds),
  ]);
  const zones = await repo.findZones(facets.zoneIds);

  return {
    data: page.rows.map((row) => maskContact(serializeVendor(row))),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts,
      facets: {
        areas: facets.areas,
        tags: facets.tags,
        foodCategories: facets.foodCategories,
        zones,
      },
    },
  };
}

export async function getVendor(
  kind: VendorKind,
  id: string,
): Promise<RestaurantDto | HomemakerDto> {
  return serializeVendor(await requireRow(kind, id));
}

/**
 * Detail view (doc 20/22): the vendor plus its documents and audit trail.
 * The detail response reveals phone/email in full (D26: lists mask, detail
 * reveals), so every open writes an auditable reveal row (doc 15 §privacy).
 */
export async function getVendorDetail(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
): Promise<VendorDetail> {
  const row = await requireRow(kind, id);
  const [documents, activity] = await Promise.all([
    repo.listDocuments(kind, id),
    repo.listActivity(id),
  ]);
  await recordAudit(prisma, {
    actorId: ctx.auth.userId,
    zoneId: row.zoneId,
    module: auditModule(kind),
    action: `${auditModule(kind)}.reveal`,
    entityType: entityType(kind),
    entityId: id,
    after: { revealed: ['phone', 'email'] },
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  });
  const extras = { documents: documents.map(toDocument), activity: activity.map(toActivity) };

  if ('foodCategory' in row) return { ...serializeHomemaker(row), ...extras };
  return { ...serializeRestaurant(row), ...extras };
}

/* ------------------------------------------------------------------ *
 * Writes (transaction + audit row)
 * ------------------------------------------------------------------ */

interface WriteOptions {
  action: string;
  zoneId: string;
  before?: unknown;
  after: unknown;
}

function auditEntry(ctx: ActorContext, kind: VendorKind, id: string, opts: WriteOptions) {
  return {
    actorId: ctx.auth.userId,
    zoneId: opts.zoneId,
    module: auditModule(kind),
    action: opts.action,
    entityType: entityType(kind),
    entityId: id,
    before: opts.before,
    after: opts.after,
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  };
}

export async function createVendor(
  ctx: ActorContext,
  kind: VendorKind,
  input: RestaurantCreateInput | HomemakerCreateInput,
): Promise<RestaurantDto | HomemakerDto> {
  const zone = await requireWritableZoneRef(input.zoneId);
  await assertNoDuplicatePhone(kind, input.zoneId, input.phone, null);

  if (kind === 'restaurant') {
    const v = input as RestaurantCreateInput;
    const data: repo.RestaurantCreateData = {
      zoneId: v.zoneId,
      name: v.name,
      ownerName: v.ownerName,
      phone: v.phone,
      email: v.email,
      address: v.address,
      area: v.area,
      lat: v.lat,
      lng: v.lng,
      cuisineTags: v.cuisineTags,
      commissionPct: v.commissionPct,
      minOrder: v.minOrder,
      gstNo: v.gstNo,
      fssaiNo: v.fssaiNo,
      openingHoursJson: repo.openingHoursValue(v.openingHours),
    };
    const created = await prisma.$transaction(async (tx) => {
      const vendor = await repo.createVendor(tx, 'restaurant', data);
      await recordAudit(
        tx,
        auditEntry(ctx, kind, vendor.id, {
          action: `${auditModule(kind)}.create`,
          zoneId: vendor.zoneId,
          after: serializeWithZone(vendor, zone),
        }),
      );
      return serializeWithZone(vendor, zone);
    });
    return created;
  }

  const v = input as HomemakerCreateInput;
  const data: repo.HomemakerCreateData = {
    zoneId: v.zoneId,
    name: v.name,
    phone: v.phone,
    email: v.email,
    address: v.address,
    area: v.area,
    lat: v.lat,
    lng: v.lng,
    specialityTags: v.specialityTags,
    foodCategory: v.foodCategory,
    experienceYears: v.experienceYears,
    isAvailable: v.isAvailable,
    dailyCapacity: v.dailyCapacity,
    commissionPct: v.commissionPct,
    minOrder: v.minOrder,
    fssaiNo: v.fssaiNo,
    openingHoursJson: repo.openingHoursValue(v.openingHours),
  };
  return prisma.$transaction(async (tx) => {
    const vendor = await repo.createVendor(tx, 'homemaker', data);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, vendor.id, {
        action: `${auditModule(kind)}.create`,
        zoneId: vendor.zoneId,
        after: serializeWithZone(vendor, zone),
      }),
    );
    return serializeWithZone(vendor, zone);
  });
}

export async function updateVendor(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  input: RestaurantUpdateInput | HomemakerUpdateInput,
): Promise<RestaurantDto | HomemakerDto> {
  const before = await requireRow(kind, id);
  const beforeDto = serializeVendor(before);

  // Commission is not grantable to a Zonal Admin (doc 04 §3).
  if ('commissionPct' in input && input.commissionPct !== undefined && !ctx.auth.isSuperAdmin) {
    throw errors.forbidden('Only a Super Admin can change commission rates');
  }

  // A phone edit keeps the one-phone-per-zone rule (doc: duplicate guard).
  if ('phone' in input && input.phone !== undefined && input.phone !== before.phone) {
    await assertNoDuplicatePhone(kind, before.zoneId, input.phone, id);
  }

  const hours = repo.openingHoursValue(input.openingHours);

  if (kind === 'restaurant') {
    const v = input as RestaurantUpdateInput;
    const data: Prisma.RestaurantUncheckedUpdateInput = {
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.ownerName !== undefined ? { ownerName: v.ownerName } : {}),
      ...(v.phone !== undefined ? { phone: v.phone } : {}),
      ...(v.email !== undefined ? { email: v.email } : {}),
      ...(v.address !== undefined ? { address: v.address } : {}),
      ...(v.area !== undefined ? { area: v.area } : {}),
      ...(v.lat !== undefined ? { lat: v.lat } : {}),
      ...(v.lng !== undefined ? { lng: v.lng } : {}),
      ...(v.cuisineTags !== undefined ? { cuisineTags: v.cuisineTags } : {}),
      ...(v.commissionPct !== undefined ? { commissionPct: v.commissionPct } : {}),
      ...(v.minOrder !== undefined ? { minOrder: v.minOrder } : {}),
      ...(v.gstNo !== undefined ? { gstNo: v.gstNo } : {}),
      ...(v.fssaiNo !== undefined ? { fssaiNo: v.fssaiNo } : {}),
      ...(hours !== undefined ? { openingHoursJson: hours } : {}),
    };
    return prisma.$transaction(async (tx) => {
      const vendor = await repo.updateVendor(tx, 'restaurant', id, data);
      const after = serializeWithZone(vendor, before.zone);
      await recordAudit(
        tx,
        auditEntry(ctx, kind, id, {
          action: `${auditModule(kind)}.update`,
          zoneId: vendor.zoneId,
          before: beforeDto,
          after,
        }),
      );
      return after;
    });
  }

  const v = input as HomemakerUpdateInput;
  const data: Prisma.HomemakerUncheckedUpdateInput = {
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.phone !== undefined ? { phone: v.phone } : {}),
    ...(v.email !== undefined ? { email: v.email } : {}),
    ...(v.address !== undefined ? { address: v.address } : {}),
    ...(v.area !== undefined ? { area: v.area } : {}),
    ...(v.lat !== undefined ? { lat: v.lat } : {}),
    ...(v.lng !== undefined ? { lng: v.lng } : {}),
    // The column is a required list — null in the contract means "clear".
    ...(v.specialityTags !== undefined ? { specialityTags: v.specialityTags ?? [] } : {}),
    ...(v.foodCategory !== undefined ? { foodCategory: v.foodCategory } : {}),
    ...(v.experienceYears !== undefined ? { experienceYears: v.experienceYears } : {}),
    ...(v.isAvailable !== undefined ? { isAvailable: v.isAvailable } : {}),
    ...(v.dailyCapacity !== undefined ? { dailyCapacity: v.dailyCapacity } : {}),
    ...(v.commissionPct !== undefined ? { commissionPct: v.commissionPct } : {}),
    ...(v.minOrder !== undefined ? { minOrder: v.minOrder } : {}),
    ...(v.fssaiNo !== undefined ? { fssaiNo: v.fssaiNo } : {}),
    ...(hours !== undefined ? { openingHoursJson: hours } : {}),
  };
  return prisma.$transaction(async (tx) => {
    const vendor = await repo.updateVendor(tx, 'homemaker', id, data);
    const after = serializeWithZone(vendor, before.zone);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.update`,
        zoneId: vendor.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

export async function changeVendorStatus(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  input: VendorStatusInput,
): Promise<RestaurantDto | HomemakerDto> {
  const before = await requireRow(kind, id);
  const beforeDto = serializeVendor(before);
  assertStatusTransition(before.status, before.verificationStatus, input.status);

  return prisma.$transaction(async (tx) => {
    const vendor = await repo.updateVendor(tx, kind, id, { status: input.status });
    const after = serializeWithZone(vendor, before.zone);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.status`,
        zoneId: vendor.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/**
 * POST /{module}/bulk (doc 22 §bulk, TD-20): change status on up to 100
 * vendors. Missing ids and rows whose current state cannot legally move to
 * the target are skipped, not errored (partial-failure semantics; when the
 * zone-scope seam lands, out-of-scope ids fall out the same way, TC-MZ-4).
 */
export async function bulkChangeVendorStatus(
  ctx: ActorContext,
  kind: VendorKind,
  input: VendorBulkStatusInput,
): Promise<VendorBulkStatusResponse> {
  const rows = await Promise.all(input.ids.map((id) => repo.findVendor(kind, id)));
  const found = rows.filter((r): r is VendorRowWithZone => r !== null);
  const skippedMissing = input.ids.length - found.length;

  const touchable = found.filter((row) => {
    try {
      assertStatusTransition(row.status, row.verificationStatus, input.status);
      return true;
    } catch {
      return false;
    }
  });
  const skipped = skippedMissing + (found.length - touchable.length);
  const first = touchable[0];
  if (!first) return { updated: 0, skipped };

  const ids = touchable.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    await repo.updateManyStatus(tx, kind, ids, input.status);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, 'bulk', {
        action: `${auditModule(kind)}.bulk.status`,
        zoneId: first.zoneId,
        after: { ids, status: input.status },
      }),
    );
  });
  return { updated: ids.length, skipped };
}

export async function setVendorVerification(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  input: VendorVerificationInput,
): Promise<RestaurantDto | HomemakerDto> {
  const before = await requireRow(kind, id);
  const beforeDto = serializeVendor(before);
  assertVerificationDecision(before.verificationStatus, input.decision);

  const data =
    input.decision === 'VERIFIED'
      ? {
          verificationStatus: 'VERIFIED' as const,
          verificationNote: input.note ?? null,
          verifiedAt: new Date(),
          verifiedBy: ctx.auth.userId,
        }
      : {
          verificationStatus: 'REJECTED' as const,
          verificationNote: input.note ?? null,
          verifiedAt: null,
          verifiedBy: null,
        };

  return prisma.$transaction(async (tx) => {
    const vendor = await repo.updateVendor(tx, kind, id, data);
    const after = serializeWithZone(vendor, before.zone);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.verification`,
        zoneId: vendor.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

export async function moveVendorZone(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  targetZoneId: string,
): Promise<RestaurantDto | HomemakerDto> {
  const before = await requireRow(kind, id);
  const beforeDto = serializeVendor(before);
  if (before.zoneId === targetZoneId) throw errors.conflict('Vendor already belongs to this zone');
  const zone = await requireWritableZoneRef(targetZoneId);

  return prisma.$transaction(async (tx) => {
    const vendor = await repo.updateVendor(tx, kind, id, { zoneId: targetZoneId });
    const after = serializeWithZone(vendor, zone);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.move-zone`,
        zoneId: targetZoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/** Soft delete (AGENTS.md default; M06 spec "soft delete"). */
export async function removeVendor(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
): Promise<{ id: string }> {
  const before = await requireRow(kind, id);
  const beforeDto = serializeVendor(before);

  await prisma.$transaction(async (tx) => {
    await repo.updateVendor(tx, kind, id, { deletedAt: new Date() });
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.delete`,
        zoneId: before.zoneId,
        before: beforeDto,
        after: { id, deletedAt: true },
      }),
    );
  });
  return { id };
}

/* ------------------------------------------------------------------ *
 * Documents (SA-2.1: doc 09 `/uploads` + `/{id}/documents`, doc 11,
 * doc 15 §retention — downloads are logged)
 * ------------------------------------------------------------------ */

/** The key must belong to this very vendor in this very zone (else 404). */
async function requireOwnedFileKey(row: VendorRowWithZone, fileKey: string): Promise<void> {
  const parsed = parseFileKey(fileKey);
  if (!parsed) {
    throw errors.validation([{ field: 'fileKey', issue: 'Invalid file key' }], 'Invalid file key');
  }
  if (parsed.entityId !== row.id || parsed.zoneId !== row.zoneId) {
    throw errors.notFound('Vendor not found');
  }
  // Full gate: object exists, stored type/size allow-listed, content sniffed.
  await assertUploadedObject(fileKey);
}

/** POST /{module}/{id}/documents (doc 09) — attach a confirmed upload. */
export async function addVendorDocument(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  input: VendorDocumentUploadInput,
): Promise<VendorDocument> {
  const row = await requireRow(kind, id);
  await requireOwnedFileKey(row, input.fileKey);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await repo.createDocument(tx, {
      vendorType: repo.vendorDocumentType(kind),
      vendorId: id,
      docType: input.docType,
      fileKey: input.fileKey,
    });
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.document.upload`,
        zoneId: row.zoneId,
        after: { documentId: created.id, docType: created.docType, fileKey: created.fileKey },
      }),
    );
    return created;
  });
  return toDocument(doc);
}

/**
 * GET /{module}/{id}/documents/{documentId}/url — short-lived signed read
 * (doc 11 "reads use short-lived signed URLs"); every download is audited
 * (doc 15), the URL itself never is.
 */
export async function getVendorDocumentUrl(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  documentId: string,
): Promise<VendorDocumentUrl> {
  const row = await requireRow(kind, id);
  const doc = await repo.findDocument(repo.vendorDocumentType(kind), id, documentId);
  if (!doc) throw errors.notFound('Document not found');

  const url = await presignRead(doc.fileKey);
  await recordAudit(prisma, {
    actorId: ctx.auth.userId,
    zoneId: row.zoneId,
    module: auditModule(kind),
    action: `${auditModule(kind)}.document.download`,
    entityType: entityType(kind),
    entityId: id,
    after: { documentId: doc.id, docType: doc.docType, fileKey: doc.fileKey },
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  });
  return { url, expiresInSec: PRESIGN_READ_TTL_SEC };
}

/** POST /{module}/{id}/documents/{documentId}/verify — per-document review (doc 21 §2). */
export async function setVendorDocumentVerification(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  documentId: string,
  input: VendorDocumentVerifyInput,
): Promise<VendorDocument> {
  const row = await requireRow(kind, id);
  const before = await repo.findDocument(repo.vendorDocumentType(kind), id, documentId);
  if (!before) throw errors.notFound('Document not found');

  const data =
    input.decision === 'VERIFIED'
      ? { verified: true, verifiedBy: ctx.auth.userId, rejectionNote: null }
      : { verified: false, verifiedBy: null, rejectionNote: input.note ?? null };

  const doc = await prisma.$transaction(async (tx) => {
    const updated = await repo.updateDocument(tx, documentId, data);
    await recordAudit(
      tx,
      auditEntry(ctx, kind, id, {
        action: `${auditModule(kind)}.document.${input.decision === 'VERIFIED' ? 'verify' : 'reject'}`,
        zoneId: row.zoneId,
        before: toDocument(before),
        after: toDocument(updated),
      }),
    );
    return updated;
  });
  return toDocument(doc);
}

/* ------------------------------------------------------------------ *
 * CSV export (doc 22 exports, doc 13 T15/T16, doc 15 §privacy)
 * ------------------------------------------------------------------ */

/** Hard cap so one request cannot stream an unbounded table. */
const EXPORT_MAX_ROWS = 5000;

const EXPORT_HEADER = ['ID', 'Name', 'Owner', 'Phone', 'Zone', 'Area', 'Status', 'Verification'];

/** Doc 13 T16: quote every cell and neutralise spreadsheet formula injection. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

/**
 * GET /{module}/export — the caller's current list filters, all matching
 * rows (not one page), zone-scoped, phone masked exactly like the list
 * (D26 — the export mirrors list privacy), audited (doc 15). Contacts and
 * documents beyond the list columns are never included.
 */
export async function exportVendorsCsv(
  ctx: ActorContext,
  kind: VendorKind,
  query: ListVendorsQuery,
): Promise<{ filename: string; csv: string }> {
  const zoneIds = await resolveZoneScope(requestedZoneIds(query));
  // Export walks the same filtered set as the list, page by page, so the
  // repository's where-clauses stay the single source of truth.
  const pageSize = 100;
  const rows: VendorRowWithZone[] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const result = await repo.listVendors(kind, { zoneIds, query: { ...query, page, pageSize } });
    total = result.total;
    rows.push(...result.rows);
    if (result.rows.length < pageSize || rows.length >= Math.min(total, EXPORT_MAX_ROWS)) break;
  }
  if (total > EXPORT_MAX_ROWS) {
    throw errors.conflict(
      `Too many records to export (${total}; the limit is ${EXPORT_MAX_ROWS}). Narrow the filters and try again.`,
    );
  }

  const lines = [csvRow(EXPORT_HEADER)];
  for (const row of rows) {
    const dto = maskContact(serializeVendor(row));
    lines.push(
      csvRow([
        shortExportId(kind, dto.id),
        dto.name,
        dto.kind === 'restaurant' ? dto.ownerName : '',
        dto.phone,
        dto.zone.name,
        dto.area ?? '',
        dto.status,
        dto.verificationStatus,
      ]),
    );
  }

  await recordAudit(prisma, {
    actorId: ctx.auth.userId,
    module: auditModule(kind),
    action: `${auditModule(kind)}.export`,
    entityType: auditModule(kind),
    entityId: 'export',
    after: {
      count: rows.length,
      filters: {
        q: query.q ?? null,
        status: query.status ?? null,
        verification: query.verification ?? null,
        area: query.area ?? null,
        tag: query.tag ?? null,
        foodCategory: query.foodCategory ?? null,
        zoneId: query.zoneId ?? null,
      },
    },
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  });

  // BOM keeps Excel happy with UTF-8; CRLF is the CSV convention (doc 13).
  return {
    filename: kind === 'restaurant' ? 'restaurants.csv' : 'homemakers.csv',
    csv: `\uFEFF${lines.join('\r\n')}\r\n`,
  };
}

function shortExportId(kind: VendorKind, id: string): string {
  return `${kind === 'restaurant' ? 'RST' : 'HFP'}-${id.slice(0, 4).toUpperCase()}`;
}
