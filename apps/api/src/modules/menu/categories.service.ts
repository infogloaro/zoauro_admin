import type {
  AuditActionKey,
  Category,
  CategoryCreateInput,
  CategoryListQuery,
  CategoryListResponse,
  CategoryUpdateInput,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { CategoryRecord, MenuDatabase, MenuTx } from './menu.repository';

// Menu categories (SA-2.4, doc 08 categories): global (zone_id null) or of one zone. Global categories are written by
// the Super Admin only (a Zonal Admin gets 403 even with menu:add); zone categories follow the zone scope. Names are
// unique case-insensitively per zone and among global ones (409). A category with live items cannot be deleted
// (409 CATEGORY_IN_USE).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');
const nameTaken = () =>
  new AppError('CONFLICT', 'A category with this name already exists here', [
    { field: 'name', issue: 'taken' },
  ]);

export class CategoriesService {
  constructor(private readonly deps: { db: MenuDatabase; clock: () => Date }) {}

  async list(ctx: AuthContext, q: CategoryListQuery): Promise<CategoryListResponse> {
    const { rows, total } = await this.deps.db.repo.listCategories(ctx, q);
    return { data: rows.map(dto), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async create(ctx: AuthContext, input: CategoryCreateInput): Promise<Category> {
    if (input.zoneId === null) {
      if (!ctx.isSuperAdmin) throw forbidden();
    } else assertCanWrite(ctx, 'menu:add', input.zoneId);
    if (await this.deps.db.repo.categoryNameTaken(input.zoneId, input.name)) throw nameTaken();
    const id = uuidv7();
    const c = await this.deps.db.transaction(async (tx) => {
      await tx.repo.insertCategory({
        id,
        zoneId: input.zoneId,
        name: input.name,
        sortOrder: input.sortOrder,
        createdBy: ctx.userId,
      });
      const created = await reload(tx, ctx, id);
      await audit(tx, created, 'category.created', undefined, view(created));
      return created;
    });
    return dto(c);
  }

  async update(ctx: AuthContext, id: string, input: CategoryUpdateInput): Promise<Category> {
    const before = await this.writable(ctx, id, 'menu:edit');
    if (
      input.name !== undefined &&
      (await this.deps.db.repo.categoryNameTaken(before.zoneId, input.name, id))
    )
      throw nameTaken();
    const c = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockCategory(id);
      await tx.repo.updateCategory(id, input, ctx.userId);
      const after = await reload(tx, ctx, id);
      await audit(tx, after, 'category.updated', view(before), view(after));
      return after;
    });
    return dto(c);
  }

  async remove(ctx: AuthContext, id: string): Promise<void> {
    await this.writable(ctx, id, 'menu:delete');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockCategory(id);
      const current = await reload(tx, ctx, id);
      const live = await tx.repo.liveItemsInCategory(id);
      if (live > 0)
        throw new AppError(
          'CATEGORY_IN_USE',
          'Move or delete the items in this category first',
          undefined,
          undefined,
          {
            items: live,
          },
        );
      await tx.repo.updateCategory(id, { deletedAt: this.deps.clock() }, ctx.userId);
      await audit(tx, current, 'category.deleted', view(current), undefined);
    });
  }

  /** Visible (else 404); global = Super Admin only (403); a zone category needs the action in its zone. */
  private async writable(
    ctx: AuthContext,
    id: string,
    key: 'menu:edit' | 'menu:delete',
  ): Promise<CategoryRecord> {
    const c = await this.deps.db.repo.findCategory(ctx, id);
    if (!c) throw notFound();
    if (c.zoneId === null) {
      if (!ctx.isSuperAdmin) throw forbidden();
    } else assertCanWrite(ctx, key, c.zoneId);
    return c;
  }
}

async function reload(tx: MenuTx, ctx: AuthContext, id: string): Promise<CategoryRecord> {
  const c = await tx.repo.getCategory(ctx, id);
  if (!c) throw notFound();
  return c;
}

function audit(
  tx: MenuTx,
  c: CategoryRecord,
  action: AuditActionKey,
  before: unknown,
  after: unknown,
): Promise<void> {
  return record(tx.audit, {
    module: 'menu',
    action,
    entity: { type: 'category', id: c.id, label: c.name, zoneId: c.zoneId },
    before,
    after,
  });
}

const view = (c: CategoryRecord) => ({ name: c.name, sortOrder: c.sortOrder, zoneId: c.zoneId });

function dto(c: CategoryRecord): Category {
  return {
    id: c.id,
    zone: c.zone,
    name: c.name,
    sortOrder: c.sortOrder,
    itemCount: c.itemCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
