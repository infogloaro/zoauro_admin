import type { MenuItem as MenuItemRow, Prisma } from '@prisma/client';
import type {
  ListMenuItemsQuery,
  ListMenuItemsResponse,
  ListMenusResponse,
  MenuItem as MenuItemDto,
  MenuItemApprovalInput,
  MenuItemBulkInput,
  MenuItemCreateInput,
  MenuItemUpdateInput,
  MenuCounts,
  MenuFacets,
  MenuOwnerKind,
} from '@zoauro/shared';
import { requestedMenuZoneIds } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import type { ZoneRef } from '../hotels/hotel.types';
import * as repo from './menu.repository';
import { BULK_EFFECTIVE_STATUSES, assertMenuApprovalTransition } from './menu.state';

/** Actor of the write (doc 07 §6: every write carries its audit row). */
export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

const OWNER_KINDS = new Set<MenuOwnerKind>(['restaurant', 'homemaker', 'hotel']);

function assertOwnerKind(value: string): MenuOwnerKind {
  if (!OWNER_KINDS.has(value as MenuOwnerKind)) {
    throw errors.validation([{ field: 'vendorType', issue: 'Unsupported provider type' }]);
  }
  return value as MenuOwnerKind;
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

function serializeItem(row: repo.MenuItemRowWithZone, vendorName: string): MenuItemDto {
  return {
    kind: 'menu-item',
    id: row.id,
    zoneId: row.zoneId,
    zone: row.zone,
    vendorType:
      row.vendorType === 'RESTAURANT'
        ? 'restaurant'
        : row.vendorType === 'HOMEMAKER'
          ? 'homemaker'
          : 'hotel',
    vendorId: row.vendorId,
    vendorName,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.price,
    dietary: row.dietary,
    approvalStatus: row.approvalStatus,
    rejectionReason: row.rejectionReason,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function serializeRows(rows: repo.MenuItemRowWithZone[]): Promise<MenuItemDto[]> {
  const names = await repo.resolveOwnerNames(
    rows.map((r) => ({
      vendorType:
        r.vendorType === 'RESTAURANT'
          ? 'restaurant'
          : r.vendorType === 'HOMEMAKER'
            ? 'homemaker'
            : 'hotel',
      vendorId: r.vendorId,
    })),
  );
  return rows.map((row) =>
    serializeItem(
      row,
      names.get(
        `${row.vendorType === 'RESTAURANT' ? 'restaurant' : row.vendorType === 'HOMEMAKER' ? 'homemaker' : 'hotel'}:${row.vendorId}`,
      ) ?? 'Unknown provider',
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Scope (doc 09 §zone scope, doc 36)
 * ------------------------------------------------------------------ */

async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

async function requireItemRow(id: string): Promise<repo.MenuItemRowWithZone> {
  const row = await repo.findItem(id);
  if (!row) throw errors.notFound('Menu item not found');
  return row;
}

/**
 * The owning provider must exist and the item's zone must be the owner's
 * zone — an item belongs to exactly one provider in exactly one zone
 * (AGENTS.md: "an order or menu item belongs to exactly one vendor").
 */
async function requireOwnerInZone(
  vendorType: MenuOwnerKind,
  vendorId: string,
  zoneId: string,
): Promise<{ id: string; name: string; zone: { id: string; name: string; city: string } }> {
  const owner = await repo.findOwner(vendorType, vendorId);
  if (!owner) throw errors.notFound('Provider not found');
  if (owner.zoneId !== zoneId) {
    throw errors.validation(
      [{ field: 'zoneId', issue: 'The provider belongs to a different zone' }],
      'The provider belongs to a different zone',
    );
  }
  return { id: owner.id, name: owner.name, zone: owner.zone };
}

/**
 * Builds a DTO from a row the current transaction just wrote. Re-reading the
 * row via the outer connection would not see the uncommitted write (the same
 * isolation trap the vendors module avoids by serializing off the write
 * result), so `zone` is carried in from the already-validated owner/row.
 */
async function serializeWrittenRow(item: MenuItemRow, zone: ZoneRef): Promise<MenuItemDto> {
  const kind: MenuOwnerKind =
    item.vendorType === 'RESTAURANT'
      ? 'restaurant'
      : item.vendorType === 'HOMEMAKER'
        ? 'homemaker'
        : 'hotel';
  const names = await repo.resolveOwnerNames([{ vendorType: kind, vendorId: item.vendorId }]);
  return serializeItem(
    { ...item, zone },
    names.get(`${kind}:${item.vendorId}`) ?? 'Unknown provider',
  );
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listMenuItems(query: ListMenuItemsQuery): Promise<ListMenuItemsResponse> {
  const zoneIds = await resolveZoneScope(requestedMenuZoneIds(query));
  const [page, counts, facets] = await Promise.all([
    repo.listItems({ zoneIds, query }),
    repo.countItems(zoneIds),
    repo.itemFacets(zoneIds),
  ]);
  const zones = await repo.findZones(facets.zoneIds);
  return {
    data: await serializeRows(page.rows),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts: counts satisfies MenuCounts,
      facets: { categories: facets.categories, zones } satisfies MenuFacets,
    },
  };
}

export async function getMenuAggregate(): Promise<ListMenusResponse> {
  const data = await repo.menusAggregate(null);
  const counts = await repo.countItems(null);
  return { data, meta: { total: counts.total, counts } };
}

export async function getMenuItem(id: string): Promise<MenuItemDto> {
  const row = await requireItemRow(id);
  const [dto] = await serializeRows([row]);
  if (!dto) throw errors.internal();
  return dto;
}

/* ------------------------------------------------------------------ *
 * Writes (transaction + audit row)
 * ------------------------------------------------------------------ */

function auditEntry(
  ctx: ActorContext,
  action: string,
  zoneId: string,
  id: string,
  opts: { before?: unknown; after: unknown },
) {
  return {
    actorId: ctx.auth.userId,
    zoneId,
    module: 'menu',
    action,
    entityType: 'menu-item',
    entityId: id,
    before: opts.before,
    after: opts.after,
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  };
}

export async function createMenuItem(
  ctx: ActorContext,
  input: MenuItemCreateInput,
): Promise<MenuItemDto> {
  const vendorType = assertOwnerKind(input.vendorType);
  const owner = await requireOwnerInZone(vendorType, input.vendorId, input.zoneId);

  return prisma.$transaction(async (tx) => {
    const item = await repo.createItem(tx, {
      zoneId: input.zoneId,
      vendorType: repo.ownerVendorType(vendorType),
      vendorId: input.vendorId,
      name: input.name,
      description: input.description,
      category: input.category,
      price: input.price,
      dietary: input.dietary,
    });
    const dto = await serializeWrittenRow(item, owner.zone);
    await recordAudit(
      tx,
      auditEntry(ctx, 'menu.create', item.zoneId, item.id, {
        after: { ...dto, ownerName: owner.name },
      }),
    );
    return dto;
  });
}

/**
 * PATCH /menu-items/{id} — name/price/etc. edits by an admin keep the stored
 * approval status (an approved item stays approved); only content fields
 * move. Approval is its own endpoint.
 */
export async function updateMenuItem(
  ctx: ActorContext,
  id: string,
  input: MenuItemUpdateInput,
): Promise<MenuItemDto> {
  const before = await requireItemRow(id);
  const beforeDto = (await serializeRows([before]))[0];

  const data: Prisma.MenuItemUncheckedUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.dietary !== undefined ? { dietary: input.dietary } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const item = await repo.updateItem(tx, id, data);
    const dto = await serializeWrittenRow(item, before.zone);
    await recordAudit(
      tx,
      auditEntry(ctx, 'menu.update', item.zoneId, id, { before: beforeDto, after: dto }),
    );
    return dto;
  });
}

/** Soft delete (AGENTS.md default). */
export async function removeMenuItem(ctx: ActorContext, id: string): Promise<{ id: string }> {
  const before = await requireItemRow(id);
  const beforeDto = (await serializeRows([before]))[0];

  await prisma.$transaction(async (tx) => {
    await repo.updateItem(tx, id, { deletedAt: new Date() });
    await recordAudit(
      tx,
      auditEntry(ctx, 'menu.delete', before.zoneId, id, {
        before: beforeDto,
        after: { id, deletedAt: true },
      }),
    );
  });
  return { id };
}

/**
 * POST /menu-items/{id}/approval — the review workflow (task: "approval
 * hierarchy preserved"; doc 10 §4 style). Reject requires a reason.
 */
export async function setMenuItemApproval(
  ctx: ActorContext,
  id: string,
  input: MenuItemApprovalInput,
): Promise<MenuItemDto> {
  const before = await requireItemRow(id);
  assertMenuApprovalTransition(before.approvalStatus, input.decision);
  const beforeDto = (await serializeRows([before]))[0];

  const data: Prisma.MenuItemUncheckedUpdateInput =
    input.decision === 'APPROVED'
      ? {
          approvalStatus: 'APPROVED',
          rejectionReason: null,
          approvedAt: new Date(),
          approvedBy: ctx.auth.userId,
        }
      : input.decision === 'REJECTED'
        ? {
            approvalStatus: 'REJECTED',
            rejectionReason: input.reason ?? null,
            approvedAt: null,
            approvedBy: null,
          }
        : { approvalStatus: 'ARCHIVED' };

  return prisma.$transaction(async (tx) => {
    const item = await repo.updateItem(tx, id, data);
    const dto = await serializeWrittenRow(item, before.zone);
    await recordAudit(
      tx,
      auditEntry(ctx, 'menu.approval', item.zoneId, id, {
        before: beforeDto,
        after: dto,
      }),
    );
    return dto;
  });
}

/**
 * POST /menu-items/bulk — bulk approve/archive within the caller's zone
 * scope; rows already in the target status are skipped, not errored.
 */
export async function bulkMenuAction(
  ctx: ActorContext,
  input: MenuItemBulkInput,
): Promise<{ updated: number; skipped: number }> {
  const rows = await Promise.all(input.ids.map((id) => repo.findItem(id)));
  const found = rows.filter((r): r is repo.MenuItemRowWithZone => r !== null);
  const skippedMissing = input.ids.length - found.length;

  const effective = BULK_EFFECTIVE_STATUSES[input.action];
  const touchable = found.filter((r) => effective.includes(r.approvalStatus));
  const skipped = skippedMissing + (found.length - touchable.length);
  if (touchable.length === 0) {
    return { updated: 0, skipped };
  }

  const decision = input.action === 'APPROVE' ? 'APPROVED' : 'ARCHIVED';
  const data: Prisma.MenuItemUncheckedUpdateInput =
    decision === 'APPROVED'
      ? {
          approvalStatus: 'APPROVED',
          rejectionReason: null,
          approvedAt: new Date(),
          approvedBy: ctx.auth.userId,
        }
      : { approvalStatus: 'ARCHIVED' };

  const ids = touchable.map((r) => r.id);
  const first = touchable[0];
  if (!first) return { updated: 0, skipped };
  await prisma.$transaction(async (tx) => {
    await tx.menuItem.updateMany({ where: { id: { in: ids } }, data });
    await recordAudit(
      tx,
      auditEntry(ctx, `menu.bulk.${decision.toLowerCase()}`, first.zoneId, 'bulk', {
        after: { ids, action: decision, reason: input.reason ?? null },
      }),
    );
  });
  return { updated: ids.length, skipped };
}
