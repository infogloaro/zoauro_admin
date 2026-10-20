import { Prisma, type PrismaClient } from '@prisma/client';
import type { CustomerListQuery, CustomerStatus, PermissionKey } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the customers module that imports Prisma. Customers are shared across zones (D14); a Zonal Admin
// sees a customer who has an address or an order in a zone where they hold the permission (D25), and every figure
// (order count, total spent, orders, addresses) is limited to those zones.

type ZoneRef = { id: string; name: string; code: string };

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: CustomerStatus;
  source: string | null;
  walletBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerFigures {
  zones: ZoneRef[];
  orderCount: number;
  totalSpent: number;
  lastOrderAt: Date | null;
}

export interface CustomerAddressRecord {
  id: string;
  label: string | null;
  address: string;
  area: string | null;
  pincode: string | null;
  zone: ZoneRef | null;
  isDefault: boolean;
}

export interface CustomerOrderRecord {
  id: string;
  orderNo: string;
  zone: ZoneRef;
  status: string;
  total: number;
  placedAt: Date;
}

/** The zones a query may read for `key`: 'ALL' for a Super Admin without ?zoneId, else a list (maybe empty). */
export type Scope = 'ALL' | readonly string[];

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  status: true,
  source: true,
  walletBalance: true,
  createdAt: true,
  updatedAt: true,
} as const;
const zoneRef = { select: { id: true, name: true, code: true } } as const;

/** `%`, `_` and `\` are literal in the search text. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export function scopeOf(ctx: AuthContext, key: PermissionKey): Scope {
  const s = zonesFor(ctx, key);
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}

/** D25: an address or an order in the scope. */
function visibleIn(scope: Scope): Prisma.CustomerWhereInput {
  if (scope === 'ALL') return { deletedAt: null };
  const zoneId = { in: [...scope] };
  return {
    deletedAt: null,
    OR: [{ addresses: { some: { zoneId, deletedAt: null } } }, { orders: { some: { zoneId } } }],
  };
}

const zoneFilter = (scope: Scope) => (scope === 'ALL' ? {} : { zoneId: { in: [...scope] } });

export class CustomersRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  private where(
    scope: Scope,
    q: CustomerListQuery,
    withStatus: boolean,
  ): Prisma.CustomerWhereInput {
    const and: Prisma.CustomerWhereInput[] = [visibleIn(scope)];
    if (withStatus && q.status) and.push({ status: q.status });
    if (q.source) and.push({ source: q.source });
    if (q.q) {
      const like = escapeLike(q.q);
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { phone: { contains: like } },
          { email: { contains: like, mode: 'insensitive' } },
        ],
      });
    }
    return { AND: and };
  }

  async list(
    scope: Scope,
    q: CustomerListQuery,
  ): Promise<{ rows: CustomerRecord[]; total: number }> {
    if (scope !== 'ALL' && scope.length === 0) return { rows: [], total: 0 };
    const where = this.where(scope, q, true);
    const [rows, total] = await Promise.all([
      this.db.customer.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: customerSelect,
      }),
      this.db.customer.count({ where }),
    ]);
    return { rows, total };
  }

  async counts(
    scope: Scope,
    q: CustomerListQuery,
  ): Promise<{ total: number; active: number; inactive: number; blocked: number }> {
    if (scope !== 'ALL' && scope.length === 0)
      return { total: 0, active: 0, inactive: 0, blocked: 0 };
    const base = this.where(scope, q, false);
    const count = (extra: Prisma.CustomerWhereInput) =>
      this.db.customer.count({ where: { AND: [base, extra] } });
    const [total, active, inactive, blocked] = await Promise.all([
      count({}),
      count({ status: 'ACTIVE' }),
      count({ status: 'INACTIVE' }),
      count({ status: 'BLOCKED' }),
    ]);
    return { total, active, inactive, blocked };
  }

  /** null for a missing customer AND for one outside the scope (D25): the caller answers 404 either way. */
  async find(scope: Scope, id: string): Promise<CustomerRecord | null> {
    if (scope !== 'ALL' && scope.length === 0) return null;
    return this.db.customer.findFirst({
      where: { AND: [visibleIn(scope), { id }] },
      select: customerSelect,
    });
  }

  /** Order figures and zones per customer, limited to the scope (D25). */
  async figures(
    scope: Scope,
    customerIds: readonly string[],
  ): Promise<Map<string, CustomerFigures>> {
    const out = new Map<string, CustomerFigures>();
    if (customerIds.length === 0) return out;
    const ids = [...customerIds];
    const [orders, delivered, addressZones, orderZones] = await Promise.all([
      this.db.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, ...zoneFilter(scope) },
        _count: { _all: true },
        _max: { placedAt: true },
      }),
      this.db.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: 'DELIVERED', ...zoneFilter(scope) },
        _sum: { total: true },
      }),
      this.db.customerAddress.findMany({
        where: {
          customerId: { in: ids },
          deletedAt: null,
          zoneId: scope === 'ALL' ? { not: null } : { in: [...scope] },
        },
        select: { customerId: true, zone: zoneRef },
      }),
      this.db.order.findMany({
        where: { customerId: { in: ids }, ...zoneFilter(scope) },
        distinct: ['customerId', 'zoneId'],
        select: { customerId: true, zone: zoneRef },
      }),
    ]);
    for (const id of ids)
      out.set(id, { zones: [], orderCount: 0, totalSpent: 0, lastOrderAt: null });
    for (const o of orders) {
      const f = out.get(o.customerId);
      if (f) {
        f.orderCount = o._count._all;
        f.lastOrderAt = o._max.placedAt;
      }
    }
    for (const d of delivered) {
      const f = out.get(d.customerId);
      if (f) f.totalSpent = d._sum.total ?? 0;
    }
    for (const r of [...addressZones, ...orderZones]) {
      const f = out.get(r.customerId);
      if (f && r.zone && !f.zones.some((z) => z.id === r.zone?.id)) f.zones.push(r.zone);
    }
    for (const f of out.values()) f.zones.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async addresses(scope: Scope, customerId: string): Promise<CustomerAddressRecord[]> {
    return this.db.customerAddress.findMany({
      where: {
        customerId,
        deletedAt: null,
        ...(scope === 'ALL' ? {} : { zoneId: { in: [...scope] } }),
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        address: true,
        area: true,
        pincode: true,
        isDefault: true,
        zone: zoneRef,
      },
    });
  }

  async recentOrders(scope: Scope, customerId: string): Promise<CustomerOrderRecord[]> {
    return this.db.order.findMany({
      where: { customerId, ...zoneFilter(scope) },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { id: true, orderNo: true, status: true, total: true, placedAt: true, zone: zoneRef },
    });
  }

  /** D63: the zone of the customer's latest order, else of their newest address; null when neither exists. */
  async latestZone(customerId: string): Promise<string | null> {
    const order = await this.db.order.findFirst({
      where: { customerId },
      orderBy: { placedAt: 'desc' },
      select: { zoneId: true },
    });
    if (order) return order.zoneId;
    const address = await this.db.customerAddress.findFirst({
      where: { customerId, deletedAt: null, zoneId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { zoneId: true },
    });
    return address?.zoneId ?? null;
  }

  /** The zones (of `among`) where the customer has an address or an order, in a stable order. */
  async zonesOfCustomer(customerId: string, among: Scope): Promise<string[]> {
    const filter = among === 'ALL' ? {} : { zoneId: { in: [...among] } };
    const [a, o] = await Promise.all([
      this.db.customerAddress.findMany({
        where: { customerId, deletedAt: null, zoneId: { not: null }, ...filter },
        select: { zoneId: true },
      }),
      this.db.order.findMany({
        where: { customerId, ...filter },
        distinct: ['zoneId'],
        select: { zoneId: true },
      }),
    ]);
    return [...new Set([...a, ...o].flatMap((r) => (r.zoneId ? [r.zoneId] : [])))].sort();
  }

  async zoneExists(zoneId: string): Promise<boolean> {
    return (await this.db.zone.count({ where: { id: zoneId, deletedAt: null } })) > 0;
  }

  /** Phone is unique across every customer, deleted ones included (the column is unique). */
  async phoneTaken(phone: string, exceptId?: string): Promise<boolean> {
    return (
      (await this.db.customer.count({
        where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) },
      })) > 0
    );
  }

  async insert(row: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    createdBy: string;
    address: {
      id: string;
      zoneId: string;
      label: string | null;
      address: string;
      area: string | null;
      pincode: string | null;
    };
  }): Promise<void> {
    await this.db.customer.create({
      data: {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        source: 'ADMIN',
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      },
    });
    await this.db.customerAddress.create({
      data: {
        ...row.address,
        customerId: row.id,
        isDefault: true,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; phone?: string; email?: string | null; status?: CustomerStatus },
    actorId: string,
  ): Promise<void> {
    await this.db.customer.update({ where: { id }, data: { ...data, updatedBy: actorId } });
  }

  async lock(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
  }
}

export interface CustomersTx {
  repo: CustomersRepository;
  audit: AuditTx;
}

export class CustomersDatabase {
  readonly repo: CustomersRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new CustomersRepository(prisma);
  }

  transaction<T>(fn: (tx: CustomersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new CustomersRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
