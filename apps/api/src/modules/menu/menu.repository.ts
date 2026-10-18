import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CategoryListQuery,
  ChangeRequestListQuery,
  DietaryType,
  MenuChangeKind,
  MenuChangeProposal,
  MenuChangeStatus,
  MenuItemListQuery,
  MenuVendorKind,
  PermissionKey,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the menu module that imports Prisma (menu items, categories, change requests). Reads are bounded by
// zonesFor(ctx, 'menu:<action>'): a Zonal Admin sees only rows in zones where they hold the permission. Global
// categories (zone_id null) are readable by every menu viewer. The colleague's repository is not reused (spec D).

const zoneRef = { select: { id: true, name: true, code: true } } as const;
const vendorRef = { select: { id: true, name: true } } as const;

const itemSelect = {
  id: true,
  zoneId: true,
  restaurantId: true,
  homemakerId: true,
  categoryId: true,
  name: true,
  description: true,
  price: true,
  stock: true,
  isAvailable: true,
  isFeatured: true,
  imageKey: true,
  adminDisabled: true,
  dietary: true,
  adminOverrideAt: true,
  createdAt: true,
  updatedAt: true,
  zone: zoneRef,
  restaurant: vendorRef,
  homemaker: vendorRef,
  category: { select: { id: true, name: true, zoneId: true } },
  changeRequests: { where: { status: 'PENDING' }, select: { id: true }, take: 1 },
} as const satisfies Prisma.MenuItemSelect;
type ItemRow = Prisma.MenuItemGetPayload<{ select: typeof itemSelect }>;

export interface MenuItemRecord {
  id: string;
  zoneId: string;
  zone: { id: string; name: string; code: string };
  vendor: { kind: MenuVendorKind; id: string; name: string };
  category: { id: string; name: string; zoneId: string | null };
  name: string;
  description: string | null;
  price: number;
  stock: number;
  isAvailable: boolean;
  isFeatured: boolean;
  imageKey: string | null;
  adminDisabled: boolean;
  dietary: DietaryType | null;
  adminOverrideAt: Date | null;
  pendingChangeRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function fromItem(r: ItemRow): MenuItemRecord {
  const vendor = r.restaurant
    ? { kind: 'RESTAURANT' as const, ...r.restaurant }
    : { kind: 'HOMEMAKER' as const, id: r.homemaker?.id ?? '', name: r.homemaker?.name ?? '' };
  return {
    id: r.id,
    zoneId: r.zoneId,
    zone: r.zone,
    vendor,
    category: r.category,
    name: r.name,
    description: r.description,
    price: r.price,
    stock: r.stock,
    isAvailable: r.isAvailable,
    isFeatured: r.isFeatured,
    imageKey: r.imageKey,
    adminDisabled: r.adminDisabled,
    dietary: r.dietary,
    adminOverrideAt: r.adminOverrideAt,
    pendingChangeRequestId: r.changeRequests[0]?.id ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Fields an item write may set. */
export interface MenuItemWrite {
  categoryId?: string;
  name?: string;
  description?: string | null;
  price?: number;
  stock?: number;
  isAvailable?: boolean;
  isFeatured?: boolean;
  dietary?: DietaryType | null;
  imageKey?: string | null;
  adminDisabled?: boolean;
  adminOverrideAt?: Date;
  deletedAt?: Date;
}

export interface CategoryRecord {
  id: string;
  zoneId: string | null;
  zone: { id: string; name: string; code: string } | null;
  name: string;
  sortOrder: number;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const changeSelect = {
  id: true,
  zoneId: true,
  menuItemId: true,
  restaurantId: true,
  homemakerId: true,
  externalItemId: true,
  kind: true,
  status: true,
  proposedJson: true,
  baseJson: true,
  source: true,
  submittedByClientId: true,
  decidedAt: true,
  decisionReason: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  zone: zoneRef,
  restaurant: vendorRef,
  homemaker: vendorRef,
  menuItem: { select: { id: true, name: true, deletedAt: true } },
  decider: vendorRef,
} as const satisfies Prisma.MenuItemChangeRequestSelect;
type ChangeRow = Prisma.MenuItemChangeRequestGetPayload<{ select: typeof changeSelect }>;

export interface ChangeRequestRecord {
  id: string;
  zoneId: string;
  zone: { id: string; name: string; code: string };
  vendor: { kind: MenuVendorKind; id: string; name: string };
  menuItem: { id: string; name: string; deleted: boolean } | null;
  externalItemId: string | null;
  kind: MenuChangeKind;
  status: MenuChangeStatus;
  proposed: MenuChangeProposal;
  base: MenuChangeProposal | null;
  submittedByClientId: string | null;
  decider: { id: string; name: string } | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  version: number;
  createdAt: Date;
}

const asProposal = (v: Prisma.JsonValue | null): MenuChangeProposal | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as MenuChangeProposal) : null;

function fromChange(r: ChangeRow): ChangeRequestRecord {
  const vendor = r.restaurant
    ? { kind: 'RESTAURANT' as const, ...r.restaurant }
    : { kind: 'HOMEMAKER' as const, id: r.homemaker?.id ?? '', name: r.homemaker?.name ?? '' };
  return {
    id: r.id,
    zoneId: r.zoneId,
    zone: r.zone,
    vendor,
    menuItem: r.menuItem
      ? { id: r.menuItem.id, name: r.menuItem.name, deleted: r.menuItem.deletedAt !== null }
      : null,
    externalItemId: r.externalItemId,
    kind: r.kind,
    status: r.status,
    proposed: asProposal(r.proposedJson) ?? {},
    base: asProposal(r.baseJson),
    submittedByClientId: r.submittedByClientId,
    decider: r.decider,
    decidedAt: r.decidedAt,
    decisionReason: r.decisionReason,
    version: r.version,
    createdAt: r.createdAt,
  };
}

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string | null;
  payload: Record<string, unknown>;
}

/** `%`, `_` and `\` are literal in the search text. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const AVAILABILITY_WHERE: Record<
  MenuItemListQuery['availability'] & string,
  Prisma.MenuItemWhereInput
> = {
  admin_disabled: { adminDisabled: true },
  vendor_off: { adminDisabled: false, isAvailable: false },
  out_of_stock: { adminDisabled: false, isAvailable: true, stock: { lte: 0 } },
  live: { adminDisabled: false, isAvailable: true, stock: { gt: 0 } },
};

export class MenuRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** Zones the actor reads with `menu:<action>`; null = none (no query runs); 'ALL' = no zone filter. */
  private zones(ctx: AuthContext, action: 'view' | 'edit'): string[] | 'ALL' | null {
    const scope = zonesFor(ctx, `menu:${action}` as PermissionKey);
    if (scope.kind === 'ALL') return 'ALL';
    return scope.zoneIds.length === 0 ? null : [...scope.zoneIds];
  }

  private itemScope(ctx: AuthContext): Prisma.MenuItemWhereInput | null {
    const zones = this.zones(ctx, 'view');
    if (zones === null) return null;
    return zones === 'ALL' ? { deletedAt: null } : { deletedAt: null, zoneId: { in: zones } };
  }

  private itemFilters(q: MenuItemListQuery): Prisma.MenuItemWhereInput[] {
    const and: Prisma.MenuItemWhereInput[] = [];
    if (q.vendorKind === 'RESTAURANT') and.push({ restaurantId: { not: null } });
    if (q.vendorKind === 'HOMEMAKER') and.push({ homemakerId: { not: null } });
    if (q.vendorId) and.push({ OR: [{ restaurantId: q.vendorId }, { homemakerId: q.vendorId }] });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.featured !== undefined) and.push({ isFeatured: q.featured });
    if (q.dietary) and.push({ dietary: q.dietary });
    if (q.q) {
      const like = escapeLike(q.q);
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { restaurant: { name: { contains: like, mode: 'insensitive' } } },
          { homemaker: { name: { contains: like, mode: 'insensitive' } } },
        ],
      });
    }
    return and;
  }

  async listItems(
    ctx: AuthContext,
    q: MenuItemListQuery,
  ): Promise<{ rows: MenuItemRecord[]; total: number }> {
    const base = this.itemScope(ctx);
    if (!base) return { rows: [], total: 0 };
    const and = [base, ...this.itemFilters(q)];
    if (q.availability) and.push(AVAILABILITY_WHERE[q.availability]);
    const where: Prisma.MenuItemWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.menuItem.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: itemSelect,
      }),
      this.db.menuItem.count({ where }),
    ]);
    return { rows: rows.map(fromItem), total };
  }

  /** Tab counts: the list's scope and filters except availability. */
  async itemCounts(
    ctx: AuthContext,
    q: MenuItemListQuery,
  ): Promise<{
    total: number;
    live: number;
    outOfStock: number;
    vendorOff: number;
    adminDisabled: number;
    pendingChanges: number;
  }> {
    const base = this.itemScope(ctx);
    if (!base)
      return {
        total: 0,
        live: 0,
        outOfStock: 0,
        vendorOff: 0,
        adminDisabled: 0,
        pendingChanges: 0,
      };
    const and = [base, ...this.itemFilters(q)];
    const count = (extra: Prisma.MenuItemWhereInput) =>
      this.db.menuItem.count({ where: { AND: [...and, extra] } });
    const [total, live, outOfStock, vendorOff, adminDisabled, pendingChanges] = await Promise.all([
      count({}),
      count(AVAILABILITY_WHERE.live),
      count(AVAILABILITY_WHERE.out_of_stock),
      count(AVAILABILITY_WHERE.vendor_off),
      count(AVAILABILITY_WHERE.admin_disabled),
      count({ changeRequests: { some: { status: 'PENDING' } } }),
    ]);
    return { total, live, outOfStock, vendorOff, adminDisabled, pendingChanges };
  }

  /** null for a missing row AND for a row outside the actor's view scope: the caller answers 404 either way. */
  async findItem(ctx: AuthContext, id: string): Promise<MenuItemRecord | null> {
    const base = this.itemScope(ctx);
    if (!base) return null;
    const row = await this.db.menuItem.findFirst({
      where: { AND: [base, { id }] },
      select: itemSelect,
    });
    return row ? fromItem(row) : null;
  }

  /** After the caller authorized the write: live items by id, unscoped (bulk: the caller checks every zone). */
  async getItems(ids: readonly string[]): Promise<MenuItemRecord[]> {
    const rows = await this.db.menuItem.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: itemSelect,
    });
    return rows.map(fromItem);
  }

  async getItem(id: string): Promise<MenuItemRecord | null> {
    const row = await this.db.menuItem.findFirst({
      where: { id, deletedAt: null },
      select: itemSelect,
    });
    return row ? fromItem(row) : null;
  }

  /** Row locks for a write, in id order (no deadlock between two bulk requests). */
  async lockItems(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.$queryRaw`SELECT id FROM menu_items WHERE id IN (${Prisma.join(
      [...ids].sort().map((i) => Prisma.sql`${i}::uuid`),
    )}) ORDER BY id FOR UPDATE`;
  }

  async insertItem(row: {
    id: string;
    zoneId: string;
    vendor: { kind: MenuVendorKind; id: string };
    categoryId: string;
    name: string;
    description?: string | null | undefined;
    price: number;
    stock: number;
    isAvailable: boolean;
    isFeatured: boolean;
    dietary?: DietaryType | null | undefined;
    imageKey?: string | null | undefined;
    createdBy: string;
  }): Promise<void> {
    await this.db.menuItem.create({
      data: {
        id: row.id,
        zoneId: row.zoneId,
        ...(row.vendor.kind === 'RESTAURANT'
          ? { restaurantId: row.vendor.id }
          : { homemakerId: row.vendor.id }),
        categoryId: row.categoryId,
        name: row.name,
        description: row.description ?? null,
        price: row.price,
        stock: row.stock,
        isAvailable: row.isAvailable,
        isFeatured: row.isFeatured,
        dietary: row.dietary ?? null,
        imageKey: row.imageKey ?? null,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      },
    });
  }

  async updateItem(id: string, w: MenuItemWrite, actorId: string | null): Promise<void> {
    await this.db.menuItem.update({ where: { id }, data: { ...w, updatedBy: actorId } });
  }

  async updateItems(ids: readonly string[], w: MenuItemWrite, actorId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.menuItem.updateMany({
      where: { id: { in: [...ids] } },
      data: { ...w, updatedBy: actorId },
    });
  }

  // ---- vendors and categories (lookups) ---------------------------------------------------------------------------

  /** A live vendor of the given kind; null when missing or deleted. zoneId null = waiting for a zone. */
  async vendor(
    kind: MenuVendorKind,
    id: string,
  ): Promise<{ id: string; name: string; zoneId: string | null } | null> {
    const where = { id, deletedAt: null };
    const select = { id: true, name: true, zoneId: true } as const;
    return kind === 'RESTAURANT'
      ? this.db.restaurant.findFirst({ where, select })
      : this.db.homemaker.findFirst({ where, select });
  }

  async categoryRef(
    id: string,
  ): Promise<{ id: string; zoneId: string | null; name: string } | null> {
    return this.db.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, zoneId: true, name: true },
    });
  }

  /** Global categories plus the zone categories the actor views (`kind` narrows). */
  private categoryScope(
    ctx: AuthContext,
    kind: CategoryListQuery['kind'],
  ): Prisma.CategoryWhereInput | null {
    const zones = this.zones(ctx, 'view');
    const zonal: Prisma.CategoryWhereInput | null =
      zones === null
        ? null
        : zones === 'ALL'
          ? { zoneId: { not: null } }
          : { zoneId: { in: zones } };
    if (kind === 'global') return { deletedAt: null, zoneId: null };
    if (kind === 'zone') return zonal ? { deletedAt: null, ...zonal } : null;
    return { deletedAt: null, OR: [{ zoneId: null }, ...(zonal ? [zonal] : [])] };
  }

  private categoryItemCount(ctx: AuthContext): Prisma.MenuItemWhereInput {
    return this.itemScope(ctx) ?? { id: { in: [] } };
  }

  async listCategories(
    ctx: AuthContext,
    q: CategoryListQuery,
  ): Promise<{ rows: CategoryRecord[]; total: number }> {
    const base = this.categoryScope(ctx, q.kind);
    if (!base) return { rows: [], total: 0 };
    const and: Prisma.CategoryWhereInput[] = [base];
    if (q.q) and.push({ name: { contains: escapeLike(q.q), mode: 'insensitive' } });
    const where: Prisma.CategoryWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.category.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: this.categorySelect(ctx),
      }),
      this.db.category.count({ where }),
    ]);
    return { rows: rows.map(fromCategory), total };
  }

  private categorySelect(ctx: AuthContext) {
    return {
      id: true,
      zoneId: true,
      name: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      zone: zoneRef,
      _count: { select: { menuItems: { where: this.categoryItemCount(ctx) } } },
    } as const;
  }

  async findCategory(ctx: AuthContext, id: string): Promise<CategoryRecord | null> {
    const base = this.categoryScope(ctx, undefined);
    if (!base) return null;
    const row = await this.db.category.findFirst({
      where: { AND: [base, { id }] },
      select: this.categorySelect(ctx),
    });
    return row ? fromCategory(row) : null;
  }

  /** Case-insensitive name taken in the same zone (or among global categories). */
  async categoryNameTaken(
    zoneId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    const hit = await this.db.category.findFirst({
      where: {
        zoneId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    return hit !== null;
  }

  async liveItemsInCategory(id: string): Promise<number> {
    return this.db.menuItem.count({ where: { categoryId: id, deletedAt: null } });
  }

  async lockCategory(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async insertCategory(row: {
    id: string;
    zoneId: string | null;
    name: string;
    sortOrder: number;
    createdBy: string;
  }): Promise<void> {
    await this.db.category.create({
      data: { ...row, updatedBy: row.createdBy },
    });
  }

  async updateCategory(
    id: string,
    w: { name?: string; sortOrder?: number; deletedAt?: Date },
    actorId: string,
  ): Promise<void> {
    await this.db.category.update({ where: { id }, data: { ...w, updatedBy: actorId } });
  }

  /** Unscoped, after the caller authorized the write. */
  async getCategory(ctx: AuthContext, id: string): Promise<CategoryRecord | null> {
    const row = await this.db.category.findFirst({
      where: { id, deletedAt: null },
      select: this.categorySelect(ctx),
    });
    return row ? fromCategory(row) : null;
  }

  // ---- change requests (R09) --------------------------------------------------------------------------------------

  private changeScope(ctx: AuthContext): Prisma.MenuItemChangeRequestWhereInput | null {
    const zones = this.zones(ctx, 'view');
    if (zones === null) return null;
    return zones === 'ALL' ? {} : { zoneId: { in: zones } };
  }

  async listChanges(
    ctx: AuthContext,
    q: ChangeRequestListQuery,
  ): Promise<{ rows: ChangeRequestRecord[]; total: number }> {
    const base = this.changeScope(ctx);
    if (!base) return { rows: [], total: 0 };
    const and: Prisma.MenuItemChangeRequestWhereInput[] = [base, { status: q.status }];
    if (q.kind) and.push({ kind: q.kind });
    if (q.vendorKind === 'RESTAURANT') and.push({ restaurantId: { not: null } });
    if (q.vendorKind === 'HOMEMAKER') and.push({ homemakerId: { not: null } });
    if (q.vendorId) and.push({ OR: [{ restaurantId: q.vendorId }, { homemakerId: q.vendorId }] });
    if (q.menuItemId) and.push({ menuItemId: q.menuItemId });
    const where: Prisma.MenuItemChangeRequestWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.menuItemChangeRequest.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: changeSelect,
      }),
      this.db.menuItemChangeRequest.count({ where }),
    ]);
    return { rows: rows.map(fromChange), total };
  }

  async findChange(ctx: AuthContext, id: string): Promise<ChangeRequestRecord | null> {
    const base = this.changeScope(ctx);
    if (!base) return null;
    const row = await this.db.menuItemChangeRequest.findFirst({
      where: { AND: [base, { id }] },
      select: changeSelect,
    });
    return row ? fromChange(row) : null;
  }

  async getChange(id: string): Promise<ChangeRequestRecord | null> {
    const row = await this.db.menuItemChangeRequest.findFirst({
      where: { id },
      select: changeSelect,
    });
    return row ? fromChange(row) : null;
  }

  async lockChange(id: string): Promise<void> {
    await this.db
      .$queryRaw`SELECT id FROM menu_item_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** The open request of an item, or of a not-yet-created item (client + external id). */
  async pendingChangeFor(
    target: { menuItemId: string } | { clientId: string; externalItemId: string },
  ): Promise<{ id: string; version: number } | null> {
    return this.db.menuItemChangeRequest.findFirst({
      where:
        'menuItemId' in target
          ? { menuItemId: target.menuItemId, status: 'PENDING' }
          : {
              submittedByClientId: target.clientId,
              externalItemId: target.externalItemId,
              kind: 'CREATE',
              status: 'PENDING',
            },
      select: { id: true, version: true },
    });
  }

  async insertChange(row: {
    id: string;
    zoneId: string;
    menuItemId: string | null;
    vendor: { kind: MenuVendorKind; id: string };
    externalItemId: string | null;
    kind: MenuChangeKind;
    proposed: MenuChangeProposal;
    base: MenuChangeProposal | null;
    source: 'APP' | 'ADMIN' | 'IMPORT';
    submittedByClientId: string | null;
  }): Promise<void> {
    await this.db.menuItemChangeRequest.create({
      data: {
        id: row.id,
        zoneId: row.zoneId,
        menuItemId: row.menuItemId,
        ...(row.vendor.kind === 'RESTAURANT'
          ? { restaurantId: row.vendor.id }
          : { homemakerId: row.vendor.id }),
        externalItemId: row.externalItemId,
        kind: row.kind,
        proposedJson: row.proposed as Prisma.InputJsonValue,
        baseJson: row.base === null ? Prisma.DbNull : (row.base as Prisma.InputJsonValue),
        source: row.source,
        submittedByClientId: row.submittedByClientId,
      },
    });
  }

  /** A decision or a supersede: bumps the version. */
  async decideChange(
    id: string,
    d: {
      status: Exclude<MenuChangeStatus, 'PENDING'>;
      decidedBy: string | null;
      decidedAt: Date;
      decisionReason: string | null;
      menuItemId?: string;
    },
  ): Promise<void> {
    await this.db.menuItemChangeRequest.update({
      where: { id },
      data: { ...d, version: { increment: 1 } },
    });
  }

  /** The vendor app's id for an item (doc 44 section 3), if the item came from an app. */
  async externalIdOf(menuItemId: string): Promise<string | null> {
    const ref = await this.db.externalRef.findFirst({
      where: { entityType: 'menu_item', internalId: menuItemId },
      select: { externalId: true },
    });
    return ref?.externalId ?? null;
  }

  async insertExternalRef(row: {
    clientId: string;
    externalId: string;
    internalId: string;
  }): Promise<void> {
    await this.db.externalRef.create({ data: { ...row, entityType: 'menu_item' } });
  }

  async insertOutbox(rows: readonly OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }
}

function fromCategory(r: {
  id: string;
  zoneId: string | null;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  zone: { id: string; name: string; code: string } | null;
  _count: { menuItems: number };
}): CategoryRecord {
  return {
    id: r.id,
    zoneId: r.zoneId,
    zone: r.zone,
    name: r.name,
    sortOrder: r.sortOrder,
    itemCount: r._count.menuItems,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export interface MenuTx {
  repo: MenuRepository;
  audit: AuditTx;
}

export class MenuDatabase {
  readonly repo: MenuRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new MenuRepository(prisma);
  }

  transaction<T>(fn: (tx: MenuTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new MenuRepository(tx), audit: auditTx(tx) }),
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }
}
