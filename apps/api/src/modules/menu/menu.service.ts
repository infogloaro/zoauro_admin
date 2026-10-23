import type { MenuItem as MenuItemRow, Prisma, VendorType } from '@prisma/client';
import { z } from 'zod';
import type {
  ListMenuItemsQuery,
  ListMenuItemChangeRequestsQuery,
  ListMenuItemChangeRequestsResponse,
  ListMenuItemsResponse,
  ListMenusResponse,
  MenuBulkPreviewResponse,
  MenuBulkPreviewRow,
  MenuChangeField,
  MenuItem as MenuItemDto,
  MenuItemApprovalInput,
  MenuItemBulkInput,
  MenuItemBulkPreviewInput,
  MenuItemChangeRequest as MenuItemChangeRequestDto,
  MenuItemChangeRequestDetail,
  MenuItemCreateInput,
  MenuItemImportInput,
  MenuItemUpdateInput,
  MenuCounts,
  MenuFacets,
  MenuImportDraft,
  MenuImportReport,
  MenuImportRowError,
  MenuOwnerKind,
} from '@zoauro/shared';
import {
  buildMenuImportReport,
  DIETARY_TYPES,
  itemNameSchema,
  parseMenuImportCsv,
  requestedMenuZoneIds,
  validateMenuImportRows,
} from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import type { ZoneRef } from '../hotels/hotel.types';
import * as repo from './menu.repository';
import {
  assertChangeDecisionAllowed,
  assertMenuApprovalTransition,
  BULK_EFFECTIVE_STATUSES,
} from './menu.state';

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

/**
 * D126 live rule: an item is live when the vendor has it available, it is
 * in stock (or stock is untracked), and the admin has not disabled it.
 * Approval status is a separate gate — the availability chip never claims
 * an item is approved.
 */
function isLive(row: {
  isAvailable: boolean;
  stock: number | null;
  adminDisabled: boolean;
}): boolean {
  return row.isAvailable && (row.stock === null || row.stock > 0) && !row.adminDisabled;
}

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
    stock: row.stock,
    isAvailable: row.isAvailable,
    isFeatured: row.isFeatured,
    imageKey: row.imageKey,
    adminDisabled: row.adminDisabled,
    adminOverrideAt: row.adminOverrideAt ? row.adminOverrideAt.toISOString() : null,
    live: isLive(row),
    dietary: row.dietary,
    approvalStatus: row.approvalStatus,
    rejectionReason: row.rejectionReason,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Menu owner-kind from a Prisma `VendorType` (items never carry DELIVERY_PARTNER). */
function ownerKindOf(vendorType: VendorType): MenuOwnerKind {
  if (vendorType === 'RESTAURANT') return 'restaurant';
  if (vendorType === 'HOMEMAKER') return 'homemaker';
  if (vendorType === 'HOTEL') return 'hotel';
  throw errors.internal();
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
      stock: input.stock ?? null,
      isAvailable: input.isAvailable ?? true,
      isFeatured: input.isFeatured ?? false,
      imageKey: input.imageKey ?? null,
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
 * The category partial unique index (vendor_type, vendor_id, category over
 * live rows) rejects a duplicate with P2002 — surface it as 409, never 500.
 * Other unique violations keep their original error.
 */
function translateCategoryConflict(error: unknown): never {
  const known =
    error instanceof Error && error.name === 'PrismaClientKnownRequestError'
      ? (error as { code?: string; meta?: { target?: unknown } })
      : null;
  if (known?.code === 'P2002') {
    const target = Array.isArray(known.meta?.target) ? known.meta.target.join(',') : '';
    if (target.includes('category') || target === '') {
      throw errors.conflict(
        'This provider already has a menu item in that category — categories are unique per provider',
      );
    }
  }
  throw error;
}

/**
 * PATCH /menu-items/{id} — name/price/etc. edits by an admin keep the stored
 * approval status (an approved item stays approved); only content fields
 * move. Approval is its own endpoint. Vendor-owned fields edited by an admin
 * stamp `admin_override_at` (doc 44); `adminDisabled` is the admin's own
 * toggle (D126) and requires a reason when disabling (doc 09).
 */
export async function updateMenuItem(
  ctx: ActorContext,
  id: string,
  input: MenuItemUpdateInput,
): Promise<MenuItemDto> {
  const before = await requireItemRow(id);
  const beforeDto = (await serializeRows([before]))[0];

  /** Vendor-owned content (D119): an admin edit here stamps the override. */
  const touchesVendorOwned =
    input.name !== undefined ||
    input.description !== undefined ||
    input.category !== undefined ||
    input.price !== undefined ||
    input.stock !== undefined ||
    input.isAvailable !== undefined ||
    input.imageKey !== undefined ||
    input.dietary !== undefined;

  const data: Prisma.MenuItemUncheckedUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.stock !== undefined ? { stock: input.stock } : {}),
    ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
    ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
    ...(input.imageKey !== undefined ? { imageKey: input.imageKey } : {}),
    ...(input.dietary !== undefined ? { dietary: input.dietary } : {}),
    ...(input.adminDisabled !== undefined ? { adminDisabled: input.adminDisabled } : {}),
    ...(touchesVendorOwned ? { adminOverrideAt: new Date() } : {}),
  };

  return prisma.$transaction(async (tx) => {
    let item: MenuItemRow;
    try {
      item = await repo.updateItem(tx, id, data);
    } catch (error) {
      translateCategoryConflict(error);
    }
    const dto = await serializeWrittenRow(item, before.zone);
    await recordAudit(
      tx,
      auditEntry(
        ctx,
        input.adminDisabled !== undefined ? 'menu.admin_changed' : 'menu.update',
        item.zoneId,
        id,
        {
          before: beforeDto,
          after: input.reason ? { ...dto, reason: input.reason } : dto,
        },
      ),
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
 * Resolves the ids of any bulk request under D124 (all-or-nothing): an id
 * that does not exist (or is outside the caller's zones once SA-1.7 wires
 * the scope in) is 404 and NOTHING changes. Duplicates are collapsed.
 */
async function requireBulkRows(ids: string[]): Promise<repo.MenuItemRowWithZone[]> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => repo.findItem(id)));
  const found = rows.filter((r): r is repo.MenuItemRowWithZone => r !== null);
  if (found.length !== unique.length) {
    throw errors.notFound('One or more menu items were not found');
  }
  return found;
}

/** New price for one row: signed percent (half-up) or a flat paise amount. */
function priceAfterBulk(
  row: repo.MenuItemRowWithZone,
  input: Extract<MenuItemBulkInput, { action: 'price' }>,
): number {
  if (input.amountPaise !== undefined) return input.amountPaise;
  const percent = input.percent;
  if (percent === undefined) {
    throw errors.validation(
      [{ field: 'percent', issue: 'Provide a percent or an amount in paise' }],
      'Provide a percent or an amount in paise',
    );
  }
  return Math.round(row.price * (1 + percent / 100));
}

/**
 * POST /menu-items/bulk — every action is all-or-nothing (D124): ids are
 * resolved first and a single unknown id 404s the whole request before any
 * write. Approval actions keep their skip semantics for rows already in the
 * target status; value actions touch every resolved row and translate the
 * category unique index into 409 (never 500). One audit row per call.
 */
export async function bulkMenuAction(
  ctx: ActorContext,
  input: MenuItemBulkInput,
): Promise<{ updated: number; skipped: number }> {
  const rows = await requireBulkRows(input.ids);

  if (input.action === 'APPROVE' || input.action === 'ARCHIVE') {
    const effective = BULK_EFFECTIVE_STATUSES[input.action];
    const touchable = rows.filter((r) => effective.includes(r.approvalStatus));
    const skipped = rows.length - touchable.length;
    if (touchable.length === 0) return { updated: 0, skipped };

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

  /* Value actions (doc 09 `{action: availability | category | price}`). */
  if (input.action === 'price') {
    // Half-up rounding can floor to 0 paise — reject before writing (all-or-nothing).
    for (const row of rows) {
      const next = priceAfterBulk(row, input);
      if (next < 1) {
        throw errors.validation(
          [{ field: 'percent', issue: `A price would fall below ₹1 for "${row.name}"` }],
          'A bulk price would fall below ₹1',
        );
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (input.action === 'availability') {
        await tx.menuItem.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { isAvailable: input.available },
        });
      } else if (input.action === 'category') {
        await tx.menuItem.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { category: input.category },
        });
      } else if (input.action === 'price') {
        for (const row of rows) {
          await tx.menuItem.update({
            where: { id: row.id },
            data: { price: priceAfterBulk(row, input) },
          });
        }
      } else {
        // APPROVE/ARCHIVE returned above — the value union cannot reach here.
        throw errors.internal();
      }
      await recordAudit(
        tx,
        auditEntry(ctx, `menu.bulk.${input.action}`, rows[0]?.zoneId ?? '', 'bulk', {
          after: {
            ids: rows.map((r) => r.id),
            action: input.action,
            ...(input.action === 'availability' ? { available: input.available } : {}),
            ...(input.action === 'category' ? { category: input.category } : {}),
            ...(input.action === 'price'
              ? {
                  ...(input.percent !== undefined ? { percent: input.percent } : {}),
                  ...(input.amountPaise !== undefined ? { amountPaise: input.amountPaise } : {}),
                }
              : {}),
            reason: input.reason ?? null,
          },
        }),
      );
    });
  } catch (error) {
    translateCategoryConflict(error);
  }
  return { updated: rows.length, skipped: 0 };
}

/**
 * POST /menu-items/bulk/preview — the dry run of the value actions: same
 * id resolution and validation as /bulk, zero writes, zero audit rows
 * (doc 44 §5 dry-run → report → apply).
 */
export async function bulkMenuPreview(
  input: MenuItemBulkPreviewInput,
): Promise<MenuBulkPreviewResponse> {
  const rows = await requireBulkRows(input.ids);

  const previewRows: MenuBulkPreviewResponse['data']['rows'] = rows.map(
    (row): MenuBulkPreviewRow => {
      if (input.action === 'availability') {
        return {
          id: row.id,
          name: row.name,
          before: { isAvailable: row.isAvailable },
          after: { isAvailable: input.available },
        };
      }
      if (input.action === 'category') {
        return {
          id: row.id,
          name: row.name,
          before: { category: row.category },
          after: { category: input.category },
        };
      }
      const next = priceAfterBulk(row, input);
      if (next < 1) {
        throw errors.validation(
          [{ field: 'percent', issue: `A price would fall below ₹1 for "${row.name}"` }],
          'A bulk price would fall below ₹1',
        );
      }
      return {
        id: row.id,
        name: row.name,
        before: { price: row.price },
        after: { price: next },
      };
    },
  );

  return {
    data: { action: input.action, total: previewRows.length, rows: previewRows },
  };
}

/* ------------------------------------------------------------------ *
 * A6 Menu import (doc 34 SA-2.5, doc 09 `POST /menu-items/import`,
 * doc 13 T16, doc 44 §5 dry-run → report → fix)
 * ------------------------------------------------------------------ */

function importOwnerKey(draft: MenuImportDraft): string {
  return `${draft.type}|${draft.provider.trim().toLowerCase()}|${draft.zone.trim().toLowerCase()}`;
}

function importItemKey(zoneId: string, vendorType: string, vendorId: string, name: string): string {
  return `${zoneId}|${vendorType}|${vendorId}|${name.trim().toLowerCase()}`;
}

/**
 * Dry-run first (report only, no writes, no audit), then a transactional
 * create with a single `menu.import` audit row. Field errors are sanitised
 * and reported per row (T16); owners are resolved by (kind, provider, zone)
 * name and ambiguous or unknown names are row errors; tuples already on that
 * provider's menu are counted as duplicates so a re-run never duplicates.
 * Imported items land PENDING — the approval workflow is untouched
 * (doc 10 §4; nothing here gates activation).
 */
export async function importMenuItems(
  ctx: ActorContext,
  input: MenuItemImportInput,
): Promise<MenuImportReport> {
  const parsed = parseMenuImportCsv(input.csv);
  if (!parsed.ok) {
    throw errors.validation([{ field: 'csv', issue: parsed.issue }], parsed.issue);
  }
  const total = parsed.rows.length;
  const { valid: fieldValid, errors: fieldErrors } = validateMenuImportRows(parsed.rows);

  const ownerMatches = await repo.findOwnersByZoneAndName(
    fieldValid.map((draft) => ({ kind: draft.type, provider: draft.provider, zone: draft.zone })),
  );
  const ownerErrors: MenuImportRowError[] = [];
  const resolved: Array<{ draft: MenuImportDraft; owner: repo.OwnerMatch }> = [];
  for (const draft of fieldValid) {
    const matches = ownerMatches.get(importOwnerKey(draft)) ?? [];
    if (matches.length === 0) {
      ownerErrors.push({
        row: draft.row,
        field: 'provider',
        issue: `No ${draft.type} named "${draft.provider}" in zone "${draft.zone}"`,
      });
      continue;
    }
    if (matches.length > 1) {
      ownerErrors.push({
        row: draft.row,
        field: 'provider',
        issue: `More than one ${draft.type} named "${draft.provider}" in zone "${draft.zone}" — provider names must be unique per zone to import`,
      });
      continue;
    }
    const owner = matches[0];
    if (owner) resolved.push({ draft, owner });
  }

  const importableTargets = resolved.map(({ draft, owner }) => ({
    draft,
    owner,
    key: importItemKey(owner.zoneId, repo.ownerVendorType(draft.type), owner.id, draft.name),
  }));
  const live = await repo.findExistingMenuState(
    resolved.map(({ draft, owner }) => ({
      zoneId: owner.zoneId,
      vendorType: repo.ownerVendorType(draft.type),
      vendorId: owner.id,
    })),
  );
  const categoryErrors: MenuImportRowError[] = [];
  const seenCategories = new Set<string>();
  const importable: typeof importableTargets = [];
  let duplicates = 0;
  for (const target of importableTargets) {
    if (live.names.has(target.key)) {
      duplicates += 1;
      continue;
    }
    const category = target.draft.category;
    if (category) {
      const categoryKey =
        `${target.owner.zoneId}|${repo.ownerVendorType(target.draft.type)}|${target.owner.id}|` +
        category.trim().toLowerCase();
      if (live.categories.has(categoryKey) || seenCategories.has(categoryKey)) {
        categoryErrors.push({
          row: target.draft.row,
          field: 'category',
          issue:
            `${target.owner.name} already has a live item in category "${category}" ` +
            '(one live item per category per provider)',
        });
        continue;
      }
      seenCategories.add(categoryKey);
    }
    importable.push(target);
  }

  const allErrors = [...fieldErrors, ...ownerErrors, ...categoryErrors];
  const invalidRows = new Set(allErrors.map((e) => e.row)).size;
  const report = buildMenuImportReport({
    dryRun: input.dryRun,
    total,
    errors: allErrors,
    duplicates,
    created: 0,
    validRows: total - invalidRows,
  });

  if (input.dryRun || importable.length === 0) return report;

  const created = await prisma.$transaction(async (tx) => {
    const count = await repo.createItems(
      tx,
      importable.map(({ draft, owner }) => ({
        zoneId: owner.zoneId,
        vendorType: repo.ownerVendorType(draft.type),
        vendorId: owner.id,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        price: draft.price,
        dietary: draft.dietary,
      })),
    );
    const first = importable[0];
    if (first) {
      await recordAudit(
        tx,
        auditEntry(ctx, 'menu.import', first.owner.zoneId, 'import', {
          after: {
            total,
            created: count,
            duplicates,
            invalid: invalidRows,
            rows: importable.map((t) => ({ row: t.draft.row, name: t.draft.name })),
          },
        }),
      );
    }
    return count;
  });
  return { ...report, created };
}

/* ------------------------------------------------------------------ *
 * R09 / D119 vendor menu change requests (doc 09
 * `/menu-items/change-requests` — admin review side). The rows are
 * produced by the vendor app through intake (contract doc 42 — a separate
 * lane); until that producer lands they arrive via fixtures/tests only, so
 * everything below is pure admin-side review. D125's
 * `menu_item.change_decided` outbox event has no outbox locally: the
 * decision writes its audit row and the event stays a doc-32 dependency.
 * ------------------------------------------------------------------ */

/** Vendor-owned fields D127(2) allows an approve to write to the live item. */
const CHANGE_PROPOSAL_FIELDS = [
  'name',
  'description',
  'price',
  'category',
  'dietary',
  'image',
  'imageKey',
] as const;

/** Proposal values are validated before they ever touch the live item. */
const changeProposalValueSchema = z
  .object({
    name: itemNameSchema,
    description: z.string().trim().max(300).nullable(),
    price: z.number().int().min(1).max(10_000_000),
    category: z.string().trim().max(60).nullable(),
    dietary: z.enum(DIETARY_TYPES),
    image: z.string().trim().min(1).max(512).nullable(),
    imageKey: z.string().trim().min(1).max(512).nullable(),
  })
  .partial();

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestedChangeZoneIds(query: { zoneId?: string | string[] }): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

async function requireChangeRequest(id: string): Promise<repo.ChangeRequestRow> {
  const row = await repo.findChangeRequest(id, null);
  if (!row) throw errors.notFound('Change request not found');
  return row;
}

/**
 * Owner of the request: from the attached item; a CREATE proposal carries
 * vendorType/vendorId (the future intake contract guarantees them — until
 * then a row without either cannot be displayed and fails loudly).
 */
function changeRequestOwner(row: repo.ChangeRequestRow): {
  kind: MenuOwnerKind;
  vendorId: string;
} {
  if (row.menuItem) {
    return { kind: ownerKindOf(row.menuItem.vendorType), vendorId: row.menuItem.vendorId };
  }
  const proposed = asRecord(row.proposedJson);
  const raw = String(proposed.vendorType ?? '').toUpperCase();
  const kind =
    raw === 'RESTAURANT'
      ? 'restaurant'
      : raw === 'HOMEMAKER'
        ? 'homemaker'
        : raw === 'HOTEL'
          ? 'hotel'
          : null;
  const vendorId = typeof proposed.vendorId === 'string' ? proposed.vendorId : null;
  if (!kind || !vendorId) throw errors.internal();
  return { kind, vendorId };
}

function changeRequestDto(
  row: repo.ChangeRequestRow,
  owner: { kind: MenuOwnerKind; vendorId: string },
  names: Map<string, string>,
): MenuItemChangeRequestDto {
  const proposed = asRecord(row.proposedJson);
  const base = row.baseJson === null || row.baseJson === undefined ? null : asRecord(row.baseJson);
  return {
    kind: 'menu-change-request',
    id: row.id,
    zoneId: row.zoneId,
    zone: row.zone,
    menuItemId: row.menuItemId,
    itemName: row.menuItem?.name ?? (typeof proposed.name === 'string' ? proposed.name : null),
    vendorType: owner.kind,
    vendorId: owner.vendorId,
    vendorName: names.get(`${owner.kind}:${owner.vendorId}`) ?? 'Unknown provider',
    changeKind: row.kind,
    status: row.status,
    proposed,
    base,
    source: row.source,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionReason: row.decisionReason,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One batched owner-name lookup per page (same pattern as serializeRows). */
async function serializeChangeRequests(
  rows: repo.ChangeRequestRow[],
): Promise<MenuItemChangeRequestDto[]> {
  const ownerByRow = new Map<string, { kind: MenuOwnerKind; vendorId: string }>();
  for (const row of rows) ownerByRow.set(row.id, changeRequestOwner(row));
  const names = await repo.resolveOwnerNames(
    [...ownerByRow.values()].map((owner) => ({ vendorType: owner.kind, vendorId: owner.vendorId })),
  );
  return rows.map((row) => {
    const owner = ownerByRow.get(row.id);
    if (!owner) throw errors.internal();
    return changeRequestDto(row, owner, names);
  });
}

async function serializeChangeRequestOne(
  row: repo.ChangeRequestRow,
): Promise<MenuItemChangeRequestDto> {
  const [dto] = await serializeChangeRequests([row]);
  if (!dto) throw errors.internal();
  return dto;
}

function changeValue(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

/** Detail = the row plus the live item and a base → live → proposed diff. */
async function serializeChangeDetail(
  row: repo.ChangeRequestRow,
): Promise<MenuItemChangeRequestDetail> {
  const base = await serializeChangeRequestOne(row);
  const itemRow = row.menuItem ? await repo.findItem(row.menuItem.id) : null;
  const live = itemRow ? ((await serializeRows([itemRow]))[0] ?? null) : null;
  const proposed = asRecord(row.proposedJson);
  const baseJson = asRecord(base.base);
  const allowed = new Set<string>(CHANGE_PROPOSAL_FIELDS);
  const keys = Object.keys(proposed).filter((key) => allowed.has(key));
  const fieldNames =
    keys.length > 0
      ? keys
      : row.kind === 'DELETE'
        ? (['name', 'description', 'price', 'category', 'dietary', 'image'] as const)
        : [];

  const fields: MenuChangeField[] = fieldNames.map((field) => {
    const liveKey = field === 'image' ? 'imageKey' : field;
    const liveValue = live ? (live as unknown as Record<string, unknown>)[liveKey] : null;
    const hasProposed =
      row.kind !== 'DELETE' && Object.prototype.hasOwnProperty.call(proposed, field);
    const proposedValue = hasProposed ? proposed[field] : null;
    return {
      field,
      base: changeValue(baseJson[field]),
      live: changeValue(liveValue),
      proposed: changeValue(proposedValue),
      changed:
        row.kind === 'DELETE'
          ? changeValue(liveValue) !== null
          : hasProposed && changeValue(proposedValue) !== changeValue(liveValue),
    };
  });

  return { ...base, live, fields };
}

export async function listMenuItemChangeRequests(
  query: ListMenuItemChangeRequestsQuery,
): Promise<ListMenuItemChangeRequestsResponse> {
  const zoneIds = await resolveZoneScope(requestedChangeZoneIds(query));
  const [page, counts] = await Promise.all([
    repo.listChangeRequests({ zoneIds, query }),
    repo.countChangeRequests(zoneIds),
  ]);
  return {
    data: await serializeChangeRequests(page.rows),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts,
    },
  };
}

export async function getMenuItemChangeRequest(id: string): Promise<MenuItemChangeRequestDetail> {
  return serializeChangeDetail(await requireChangeRequest(id));
}

export interface MenuItemChangeDecisionArgs {
  version: number;
  decision: 'APPROVED' | 'REJECTED';
  reason?: string;
}

/** Applies an approved proposal to the live item, per change kind (D127(2)). */
async function applyApprovedChange(
  tx: Prisma.TransactionClient,
  row: repo.ChangeRequestRow,
  owner: { kind: MenuOwnerKind; vendorId: string },
): Promise<void> {
  const proposed = asRecord(row.proposedJson);

  if (row.kind === 'DELETE') {
    if (row.menuItemId) {
      await tx.menuItem.updateMany({
        where: { id: row.menuItemId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    return;
  }

  if (row.kind === 'CREATE') {
    if (row.menuItemId) return; // already materialised — decide only
    const parsed = changeProposalValueSchema.parse(proposed);
    if (parsed.name === undefined || parsed.price === undefined || parsed.dietary === undefined) {
      throw errors.validation(
        [{ field: 'proposed', issue: 'A CREATE proposal needs name, price and dietary' }],
        'A CREATE proposal needs name, price and dietary',
      );
    }
    const created = await tx.menuItem.create({
      data: {
        zoneId: row.zoneId,
        vendorType: repo.ownerVendorType(owner.kind),
        vendorId: owner.vendorId,
        name: parsed.name,
        description: parsed.description ?? null,
        category: parsed.category ?? null,
        price: parsed.price,
        stock: null,
        isAvailable: true,
        isFeatured: false,
        imageKey: parsed.imageKey ?? parsed.image ?? null,
        dietary: parsed.dietary,
      },
    });
    await tx.menuItemChangeRequest.update({
      where: { id: row.id },
      data: { menuItemId: created.id },
    });
    return;
  }

  // UPDATE: only the six vendor-owned content fields (D127(2)); stock and
  // availability never arrive here — they are immediate for the vendor.
  if (!row.menuItemId) {
    throw errors.conflict('This change request has no menu item to update');
  }
  const parsed = changeProposalValueSchema.parse(proposed);
  const imageKey = parsed.imageKey ?? parsed.image;
  const data: Prisma.MenuItemUncheckedUpdateInput = {
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.price !== undefined ? { price: parsed.price } : {}),
    ...(parsed.category !== undefined ? { category: parsed.category } : {}),
    ...(parsed.dietary !== undefined ? { dietary: parsed.dietary } : {}),
    ...(imageKey !== undefined ? { imageKey } : {}),
  };
  if (Object.keys(data).length === 0) {
    throw errors.validation(
      [{ field: 'proposed', issue: 'No vendor-owned fields to apply' }],
      'No vendor-owned fields to apply',
    );
  }
  try {
    await tx.menuItem.updateMany({
      where: { id: row.menuItemId, deletedAt: null },
      data,
    });
  } catch (error) {
    translateCategoryConflict(error);
  }
}

/**
 * POST /menu-items/change-requests/{id}/approve | /reject — optimistic
 * version check (row is re-matched on status+version inside the
 * transaction), then apply/decide + one audit row. Reject needs a reason
 * (contract); approve applies only the vendor-owned fields (D127(2)).
 */
export async function decideMenuItemChangeRequest(
  ctx: ActorContext,
  id: string,
  input: MenuItemChangeDecisionArgs,
): Promise<MenuItemChangeRequestDetail> {
  const row = await requireChangeRequest(id);
  assertChangeDecisionAllowed(row.status);
  if (row.version !== input.version) {
    throw errors.conflict(
      'This change request has changed since you loaded it — reload and try again',
    );
  }
  const owner = changeRequestOwner(row);
  const target = input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';

  await prisma.$transaction(async (tx) => {
    const res = await tx.menuItemChangeRequest.updateMany({
      where: { id: row.id, status: 'PENDING', version: input.version },
      data: {
        status: target,
        decidedBy: ctx.auth.userId,
        decidedAt: new Date(),
        decisionReason: input.reason ?? null,
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) {
      throw errors.conflict(
        'This change request has changed since you loaded it — reload and try again',
      );
    }
    if (input.decision === 'APPROVED') {
      await applyApprovedChange(tx, row, owner);
    }
    await recordAudit(tx, {
      actorId: ctx.auth.userId,
      zoneId: row.zoneId,
      module: 'menu',
      action: `menu.change-request.${input.decision === 'APPROVED' ? 'approve' : 'reject'}`,
      entityType: 'menu-change-request',
      entityId: row.id,
      before: { status: row.status, version: row.version },
      after: { status: target, menuItemId: row.menuItemId, reason: input.reason ?? null },
      ip: ctx.auth.ip,
      requestId: ctx.requestId,
    });
  });

  return serializeChangeDetail(await requireChangeRequest(row.id));
}
