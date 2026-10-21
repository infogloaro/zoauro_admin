import type {
  DeliveryPartnerCreateInput,
  DeliveryPartnerForceOfflineInput,
  DeliveryPartnerUpdateInput,
  DeliveryPartnerVerificationInput,
  DeliveryPartner as DeliveryPartnerDto,
  ListDeliveryPartnersQuery,
  ListDeliveryPartnersResponse,
} from '@zoauro/shared';
import { requestedPartnerZoneIds } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { maskPhone } from '../../lib/contact-mask';
import { recordAudit } from '../audit/audit.service';
import * as repo from './delivery-partner.repository';
import { assertVerificationDecision, isOnDuty } from './delivery-partner.state';

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
 * Phone arrives masked (D26 / doc 15) — doc 09 documents no reveal endpoint
 * for partners, so the full number leaves the API only through the audited
 * reveal once that contract gap is closed (handoff).
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
