import type { Zone as ZoneModel } from '@prisma/client';
import type { ZoneCreateInput, ZoneImpact, ZoneUpdateInput, ListZonesQuery } from '@zoauro/shared';
import { ZONE_DOT_PALETTE } from '@zoauro/shared';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { prisma } from '../../lib/db';
import { recordAudit } from '../audit/audit.service';
import * as repo from './zones.repository';

export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

/**
 * Sources the impact check will count once F1.1 lands the operational tables
 * (doc 08). Until then the check is explicitly incomplete and deactivation is
 * refused with 409 rather than pretending the impact is zero.
 */
export const PENDING_IMPACT_SOURCES = [
  'orders',
  'restaurants',
  'homemakers',
  'delivery_partners',
  'customers',
  'admin_zone_assignments',
] as const;

export function serializeZone(zone: ZoneModel): {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  pincodeFrom: string | null;
  pincodeTo: string | null;
  deliveryCharge: number;
  status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING';
  description: string | null;
  colorHex: string;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: zone.id,
    name: zone.name,
    code: zone.code,
    city: zone.city,
    state: zone.state,
    pincodeFrom: zone.pincodeFrom,
    pincodeTo: zone.pincodeTo,
    deliveryCharge: zone.deliveryCharge,
    status: zone.status,
    description: zone.description,
    colorHex: zone.colorHex,
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
  };
}

/** Uppercase A-Z0-9 slug used in order numbers (R-ORD-1); first-come uniqueness. */
export function generateZoneCode(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return slug.length >= 2 ? slug : 'ZN';
}

function pickColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return ZONE_DOT_PALETTE[hash % ZONE_DOT_PALETTE.length] ?? '#2F6BFF';
}

export async function getImpact(_zoneId: string): Promise<ZoneImpact> {
  // Counts are wired here when F1.1 migrates the operational tables; the
  // response shape is stable so the UI renders both states today and later.
  return {
    complete: false,
    pendingSources: [...PENDING_IMPACT_SOURCES],
    counts: {
      openOrders: null,
      restaurants: null,
      homemakers: null,
      deliveryPartners: null,
      customers: null,
      zonalAdmins: null,
    },
  };
}

async function requireCompleteImpactForDeactivate(zoneId: string): Promise<void> {
  const impact = await getImpact(zoneId);
  if (!impact.complete) {
    throw errors.conflict(
      'Deactivation is blocked while the impact check is incomplete. Related records (orders, vendors, partners, customers, zone teams) are not queryable until those modules are migrated (F1.1). No changes were made.',
      impact.pendingSources.map((source) => ({
        field: source,
        issue: 'Dependency table not yet migrated',
      })),
    );
  }
}

export async function listZones(query: ListZonesQuery): Promise<{
  data: ReturnType<typeof serializeZone>[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    counts: Awaited<ReturnType<typeof repo.countZonesByStatus>>;
    facets: Awaited<ReturnType<typeof repo.listZoneFacets>>;
  };
}> {
  const [{ rows, total }, counts, facets] = await Promise.all([
    repo.listZones(query),
    repo.countZonesByStatus(),
    repo.listZoneFacets(),
  ]);
  return {
    data: rows.map(serializeZone),
    meta: { page: query.page, pageSize: query.pageSize, total, counts, facets },
  };
}

export async function getZone(id: string): Promise<ReturnType<typeof serializeZone>> {
  const zone = await repo.findZoneById(id);
  if (!zone) throw errors.notFound('Zone not found');
  return serializeZone(zone);
}

async function assertUnique(
  input: { name?: string; code?: string },
  excludeId?: string,
): Promise<void> {
  if (input.name) {
    const clash = await repo.findZoneByName(input.name, excludeId);
    if (clash) {
      throw errors.conflict('A zone with this name already exists', [
        { field: 'name', issue: 'Must be unique' },
      ]);
    }
  }
  if (input.code) {
    const clash = await repo.findZoneByCode(input.code, excludeId);
    if (clash) {
      throw errors.conflict('A zone with this code already exists', [
        { field: 'code', issue: 'Must be unique' },
      ]);
    }
  }
}

export async function createZone(
  ctx: ActorContext,
  input: ZoneCreateInput,
): Promise<ReturnType<typeof serializeZone>> {
  await assertUnique({ name: input.name, code: input.code });

  let code = input.code ?? generateZoneCode(input.name);
  if (!input.code) {
    // Auto-generated codes must not collide (e.g. two zones named "Salem").
    let attempt = 0;
    while (await repo.findZoneByCode(code)) {
      attempt += 1;
      code = `${generateZoneCode(input.name).slice(0, 6)}${attempt}`;
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const zone = await tx.zone.create({
      data: {
        name: input.name,
        code,
        city: input.city,
        state: input.state,
        pincodeFrom: input.pincodeFrom,
        pincodeTo: input.pincodeTo,
        deliveryCharge: input.deliveryCharge,
        status: input.status,
        description: input.description,
        colorHex: input.colorHex ?? pickColor(input.name),
      },
    });
    await recordAudit(tx, {
      actorId: ctx.auth.userId,
      zoneId: zone.id,
      module: 'zones',
      action: 'zones.create',
      entityType: 'zone',
      entityId: zone.id,
      after: serializeZone(zone),
      ip: ctx.auth.ip,
      requestId: ctx.requestId,
    });
    return zone;
  });
  return serializeZone(created);
}

export async function updateZone(
  ctx: ActorContext,
  id: string,
  input: ZoneUpdateInput,
): Promise<ReturnType<typeof serializeZone>> {
  const existing = await repo.findZoneById(id);
  if (!existing) throw errors.notFound('Zone not found');

  await assertUnique({ name: input.name, code: input.code }, id);

  const deactivating = input.status === 'INACTIVE' && existing.status !== 'INACTIVE';
  if (deactivating) {
    await requireCompleteImpactForDeactivate(id);
  }

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.pincodeFrom !== undefined ? { pincodeFrom: input.pincodeFrom } : {}),
    ...(input.pincodeTo !== undefined ? { pincodeTo: input.pincodeTo } : {}),
    ...(input.deliveryCharge !== undefined ? { deliveryCharge: input.deliveryCharge } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.colorHex !== undefined ? { colorHex: input.colorHex } : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    const zone = await tx.zone.update({ where: { id }, data });
    await recordAudit(tx, {
      actorId: ctx.auth.userId,
      zoneId: zone.id,
      module: 'zones',
      action: deactivating
        ? 'zones.deactivate'
        : input.status === 'ACTIVE' && existing.status !== 'ACTIVE'
          ? 'zones.activate'
          : 'zones.update',
      entityType: 'zone',
      entityId: zone.id,
      before: serializeZone(existing),
      after: serializeZone(zone),
      ip: ctx.auth.ip,
      requestId: ctx.requestId,
    });
    return zone;
  });
  return serializeZone(updated);
}

/** Doc 09: DELETE /zones/{id} = deactivate with impact check (soft semantics; no hard delete). */
export async function deactivateZone(
  ctx: ActorContext,
  id: string,
): Promise<ReturnType<typeof serializeZone>> {
  const existing = await repo.findZoneById(id);
  if (!existing) throw errors.notFound('Zone not found');
  if (existing.status === 'INACTIVE') {
    throw errors.conflict('Zone is already inactive');
  }
  await requireCompleteImpactForDeactivate(id);

  const deactivated = await prisma.$transaction(async (tx) => {
    const zone = await tx.zone.update({ where: { id }, data: { status: 'INACTIVE' } });
    await recordAudit(tx, {
      actorId: ctx.auth.userId,
      zoneId: zone.id,
      module: 'zones',
      action: 'zones.deactivate',
      entityType: 'zone',
      entityId: zone.id,
      before: serializeZone(existing),
      after: serializeZone(zone),
      ip: ctx.auth.ip,
      requestId: ctx.requestId,
    });
    return zone;
  });
  return serializeZone(deactivated);
}
