import {
  menuAvailabilityOf,
  type AuditActionKey,
  type MenuBulkInput,
  type MenuBulkPreview,
  type MenuBulkResult,
  type MenuCounts,
  type MenuItemCreateInput,
  type MenuItemDetail,
  type MenuItemListItem,
  type MenuItemListQuery,
  type MenuItemUpdateInput,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { adminChangedRow } from './menu.events';
import { planBulk, type BulkPlan } from './menu.bulk';
import type { MenuDatabase, MenuItemRecord, MenuItemWrite, MenuTx } from './menu.repository';

// Menu items (SA-2.4, ZA-2.3, D119, D124, D126). The route checks the module permission; this service checks the
// zone of the object (404 outside the actor's scope, 403 for a missing action). Exactly one vendor per item and the
// item's zone is the vendor's. Admin edits apply at once (change requests are for vendor changes); editing a
// vendor-owned field sets admin_override_at (doc 44). admin_disabled is admin-only and goes to the apps through the
// outbox in the same transaction.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const invalid = (field: string, issue: string, message: string) =>
  new AppError('VALIDATION_ERROR', message, [{ field, issue }]);

/** Vendor-owned fields (doc 44): an admin edit of any of them sets admin_override_at. */
const VENDOR_OWNED: readonly (keyof MenuItemUpdateInput)[] = [
  'categoryId',
  'name',
  'description',
  'price',
  'stock',
  'dietary',
  'imageKey',
];

export interface MenuDeps {
  db: MenuDatabase;
  /** the uploads module's gate for a fileKey (MENU_IMAGE) */
  uploads: { assertUploaded(ctx: AuthContext, fileKey: string): Promise<unknown> };
  clock: () => Date;
}

export class MenuService {
  constructor(private readonly deps: MenuDeps) {}

  async list(
    ctx: AuthContext,
    q: MenuItemListQuery,
  ): Promise<{
    data: MenuItemListItem[];
    meta: { page: number; pageSize: number; total: number; counts: MenuCounts };
  }> {
    const repo = this.deps.db.repo;
    const [{ rows, total }, counts] = await Promise.all([
      repo.listItems(ctx, q),
      repo.itemCounts(ctx, q),
    ]);
    return {
      data: rows.map(listItem),
      meta: { page: q.page, pageSize: q.pageSize, total, counts },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<MenuItemDetail> {
    const item = await this.deps.db.repo.findItem(ctx, id);
    if (!item) throw notFound();
    return detail(item);
  }

  async create(ctx: AuthContext, input: MenuItemCreateInput): Promise<MenuItemDetail> {
    const vendor = await this.deps.db.repo.vendor(input.vendorKind, input.vendorId);
    if (!vendor) throw notFound();
    if (vendor.zoneId === null)
      throw new AppError('CONFLICT', 'Move the vendor into a zone before adding menu items');
    const zoneId = vendor.zoneId;
    assertCanWrite(ctx, 'menu:add', zoneId);
    await this.assertCategory(input.categoryId, zoneId);
    if (input.imageKey !== undefined)
      await this.assertImage(ctx, input.imageKey, zoneId, vendor.id);
    const id = uuidv7();
    const item = await this.deps.db.transaction(async (tx) => {
      await tx.repo.insertItem({
        id,
        zoneId,
        vendor: { kind: input.vendorKind, id: vendor.id },
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        price: input.price,
        stock: input.stock,
        isAvailable: input.isAvailable,
        isFeatured: input.isFeatured,
        dietary: input.dietary,
        imageKey: input.imageKey,
        createdBy: ctx.userId,
      });
      const created = await reload(tx, id);
      await audit(tx, created, 'menu_item.created', undefined, auditView(created));
      return created;
    });
    return detail(item);
  }

  async update(ctx: AuthContext, id: string, input: MenuItemUpdateInput): Promise<MenuItemDetail> {
    const before = await this.writable(ctx, id, 'menu:edit');
    if (input.categoryId !== undefined) await this.assertCategory(input.categoryId, before.zoneId);
    if (
      input.imageKey !== undefined &&
      input.imageKey !== null &&
      input.imageKey !== before.imageKey
    )
      await this.assertImage(ctx, input.imageKey, before.zoneId, before.vendor.id);
    const { adminDisabled, reason, ...fields } = input;
    const w: MenuItemWrite = { ...fields };
    if (VENDOR_OWNED.some((f) => input[f] !== undefined)) w.adminOverrideAt = this.deps.clock();
    const toggles = adminDisabled !== undefined && adminDisabled !== before.adminDisabled;
    if (toggles) w.adminDisabled = adminDisabled;
    const item = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockItems([id]);
      const current = await reload(tx, id);
      if (Object.keys(w).length > 0) await tx.repo.updateItem(id, w, ctx.userId);
      const after = await reload(tx, id);
      if (Object.keys(fields).length > 0)
        await audit(tx, after, 'menu_item.updated', fieldView(current), fieldView(after));
      if (toggles) {
        await audit(
          tx,
          after,
          after.adminDisabled ? 'menu_item.admin_disabled' : 'menu_item.admin_enabled',
          { adminDisabled: current.adminDisabled },
          { adminDisabled: after.adminDisabled },
          reason,
        );
        await tx.repo.insertOutbox([
          adminChangedRow(
            {
              id: after.id,
              zoneId: after.zoneId,
              vendorId: after.vendor.id,
              updatedAt: after.updatedAt,
              externalId: await tx.repo.externalIdOf(after.id),
            },
            after.adminDisabled,
            reason,
            ctx.userId,
            this.deps.clock(),
          ),
        ]);
      }
      return after;
    });
    return detail(item);
  }

  /** Soft delete (doc 09 DELETE). */
  async remove(ctx: AuthContext, id: string): Promise<void> {
    await this.writable(ctx, id, 'menu:delete');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockItems([id]);
      const current = await reload(tx, id);
      await tx.repo.updateItem(id, { deletedAt: this.deps.clock() }, ctx.userId);
      await audit(tx, current, 'menu_item.deleted', auditView(current), undefined);
    });
  }

  // ---- bulk (D124) ------------------------------------------------------------------------------------------------

  /** Nothing is written; the same plan as apply. */
  async bulkPreview(ctx: AuthContext, input: MenuBulkInput): Promise<MenuBulkPreview> {
    const { plan } = await this.planFor(ctx, input, this.deps.db.repo);
    return { action: plan.action, changes: plan.changes, skipped: plan.skipped };
  }

  /** All-or-nothing: any id missing or outside the caller's zones is 404 and nothing changes. One audit row. */
  async bulkApply(ctx: AuthContext, input: MenuBulkInput): Promise<MenuBulkResult> {
    await this.planFor(ctx, input, this.deps.db.repo); // fail fast before taking locks
    return this.deps.db.transaction(async (tx) => {
      await tx.repo.lockItems(input.ids);
      const { plan, items } = await this.planFor(ctx, input, tx.repo);
      await this.applyPlan(tx, ctx, plan);
      if (plan.changeIds.length > 0) {
        // one menu_item.bulk_updated row per zone touched (a menu_item row needs its zone; usually one zone, doc 32)
        const zoneOf = new Map(items.map((i) => [i.id, i.zoneId]));
        const byZone = new Map<string, typeof plan.changes>();
        for (const c of plan.changes) {
          const z = zoneOf.get(c.id) ?? '';
          byZone.set(z, [...(byZone.get(z) ?? []), c]);
        }
        for (const [zoneId, changes] of byZone)
          await record(tx.audit, {
            module: 'menu',
            action: 'menu_item.bulk_updated',
            entity: { type: 'menu_item', label: `${changes.length} items`, zoneId },
            before: {
              action: plan.action,
              items: changes.map((c) => ({ id: c.id, value: c.before })),
            },
            after: {
              action: plan.action,
              items: changes.map((c) => ({ id: c.id, value: c.after })),
            },
            ...(input.action === 'availability' && input.reason ? { note: input.reason } : {}),
          });
        if (input.action === 'availability') {
          const at = this.deps.clock();
          const changed = await tx.repo.getItems(plan.changeIds);
          const rows = [];
          for (const i of changed)
            rows.push(
              adminChangedRow(
                {
                  id: i.id,
                  zoneId: i.zoneId,
                  vendorId: i.vendor.id,
                  updatedAt: i.updatedAt,
                  externalId: await tx.repo.externalIdOf(i.id),
                },
                input.adminDisabled,
                input.reason,
                ctx.userId,
                at,
              ),
            );
          await tx.repo.insertOutbox(rows);
        }
      }
      return {
        action: plan.action,
        changes: plan.changes,
        skipped: plan.skipped,
        updated: plan.changeIds.length,
      };
    });
  }

  private async planFor(
    ctx: AuthContext,
    input: MenuBulkInput,
    repo: MenuDatabase['repo'],
  ): Promise<{ plan: BulkPlan; items: MenuItemRecord[] }> {
    const items = await repo.getItems(input.ids);
    if (items.length !== input.ids.length) throw notFound();
    for (const i of items) assertCanWrite(ctx, 'menu:edit', i.zoneId);
    let category: { id: string; zoneId: string | null } | null = null;
    if (input.action === 'category') {
      category = await repo.categoryRef(input.categoryId);
      if (
        !category ||
        (category.zoneId !== null && !items.some((i) => i.zoneId === category?.zoneId))
      )
        throw invalid(
          'categoryId',
          'not_found',
          'Choose a category of these items’ zone or a global one',
        );
    }
    const bulkItems = items.map((i) => ({
      id: i.id,
      zoneId: i.zoneId,
      name: i.name,
      price: i.price,
      categoryId: i.category.id,
      adminDisabled: i.adminDisabled,
    }));
    return { plan: planBulk(input, bulkItems, category), items };
  }

  private async applyPlan(tx: MenuTx, ctx: AuthContext, plan: BulkPlan): Promise<void> {
    const w = plan.write;
    if (w.field === 'adminDisabled')
      await tx.repo.updateItems(plan.changeIds, { adminDisabled: w.value }, ctx.userId);
    else if (w.field === 'categoryId')
      await tx.repo.updateItems(
        plan.changeIds,
        { categoryId: w.value, adminOverrideAt: this.deps.clock() },
        ctx.userId,
      );
    else
      for (const [id, price] of w.values)
        await tx.repo.updateItem(id, { price, adminOverrideAt: this.deps.clock() }, ctx.userId);
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------

  /** Visible (else 404) and the action held in the item's zone (404/403). */
  private async writable(
    ctx: AuthContext,
    id: string,
    key: 'menu:edit' | 'menu:delete',
  ): Promise<MenuItemRecord> {
    const item = await this.deps.db.repo.findItem(ctx, id);
    if (!item) throw notFound();
    assertCanWrite(ctx, key, item.zoneId);
    return item;
  }

  /** A live category that is global or of the item's zone (422 otherwise). */
  private async assertCategory(categoryId: string, zoneId: string): Promise<void> {
    const c = await this.deps.db.repo.categoryRef(categoryId);
    if (!c || (c.zoneId !== null && c.zoneId !== zoneId))
      throw invalid('categoryId', 'not_found', 'Choose a category of this zone or a global one');
  }

  /** A confirmed upload under this vendor's key prefix (D120). */
  private async assertImage(
    ctx: AuthContext,
    key: string,
    zoneId: string,
    vendorId: string,
  ): Promise<void> {
    if (!key.startsWith(`zone/${zoneId}/${vendorId}/`))
      throw invalid('imageKey', 'other_entity', 'The image was uploaded for another vendor');
    await this.deps.uploads.assertUploaded(ctx, key);
  }
}

async function reload(tx: MenuTx, id: string): Promise<MenuItemRecord> {
  const item = await tx.repo.getItem(id);
  if (!item) throw notFound();
  return item;
}

function audit(
  tx: MenuTx,
  item: MenuItemRecord,
  action: AuditActionKey,
  before: unknown,
  after: unknown,
  note?: string,
): Promise<void> {
  return record(tx.audit, {
    module: 'menu',
    action,
    entity: { type: 'menu_item', id: item.id, label: item.name, zoneId: item.zoneId },
    before,
    after,
    ...(note ? { note } : {}),
  });
}

/** The edited fields only: the admin toggle has its own audit rows. */
function fieldView(i: MenuItemRecord) {
  const v: Partial<ReturnType<typeof auditView>> = auditView(i);
  delete v.adminDisabled;
  return v;
}

function auditView(i: MenuItemRecord) {
  return {
    name: i.name,
    description: i.description,
    price: i.price,
    stock: i.stock,
    categoryId: i.category.id,
    isFeatured: i.isFeatured,
    dietary: i.dietary,
    imageKey: i.imageKey,
    adminDisabled: i.adminDisabled,
  };
}

export function listItem(i: MenuItemRecord): MenuItemListItem {
  return {
    id: i.id,
    zone: i.zone,
    vendor: i.vendor,
    category: { id: i.category.id, name: i.category.name, global: i.category.zoneId === null },
    name: i.name,
    description: i.description,
    price: i.price,
    stock: i.stock,
    isAvailable: i.isAvailable,
    isFeatured: i.isFeatured,
    adminDisabled: i.adminDisabled,
    availability: menuAvailabilityOf(i),
    dietary: i.dietary,
    hasImage: i.imageKey !== null,
    hasPendingChange: i.pendingChangeRequestId !== null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

function detail(i: MenuItemRecord): MenuItemDetail {
  return {
    ...listItem(i),
    adminOverrideAt: i.adminOverrideAt?.toISOString() ?? null,
    pendingChangeRequestId: i.pendingChangeRequestId,
  };
}
