import type {
  AuditActionKey,
  CustomerBlockInput,
  CustomerContact,
  CustomerCreateInput,
  CustomerDetail,
  CustomerListItem,
  CustomerListQuery,
  CustomerListResponse,
  CustomerUnblockInput,
  CustomerUpdateInput,
  PermissionKey,
} from '@zoauro/shared';
import { maskEmail, maskPhone, record, uuidv7 } from '../../lib/audit';
import { can, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import {
  scopeOf,
  type CustomerFigures,
  type CustomerRecord,
  type CustomersDatabase,
  type CustomersTx,
} from './customers.repository';

// M09 Customers (doc 09, D14, D25, D26, D28, D63). A customer is visible where they have an address or an order (D25).
// A write is allowed in a zone where the customer is visible and the member holds the action; that zone is the zone of
// the audit row (D63). A Super Admin's audit row carries the zone of the customer's latest order or address (D63).

/** D26: audited reveals per member and hour (same default as vendors, doc 32). */
export const CUSTOMER_REVEALS_PER_HOUR = 30;

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');
const phoneTaken = () =>
  new AppError('CONFLICT', 'Another customer already has this phone number', [
    { field: 'phone', issue: 'taken' },
  ]);
const NO_FIGURES: CustomerFigures = { zones: [], orderCount: 0, totalSpent: 0, lastOrderAt: null };

export class CustomersService {
  constructor(
    private readonly deps: { db: CustomersDatabase; limiter: RateLimiter; clock: () => Date },
  ) {}

  async list(ctx: AuthContext, q: CustomerListQuery): Promise<CustomerListResponse> {
    const repo = this.deps.db.repo;
    const scope = scopeOf(ctx, 'customers:view');
    const [{ rows, total }, counts] = await Promise.all([
      repo.list(scope, q),
      repo.counts(scope, q),
    ]);
    const figures = await repo.figures(
      scope,
      rows.map((r) => r.id),
    );
    return {
      data: rows.map((r) => listItem(r, figures.get(r.id) ?? NO_FIGURES)),
      meta: { page: q.page, pageSize: q.pageSize, total, counts },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<CustomerDetail> {
    const scope = scopeOf(ctx, 'customers:view');
    const c = await this.deps.db.repo.find(scope, id);
    if (!c) throw notFound();
    return this.toDetail(ctx, c);
  }

  /** D26: unmasked phone and email; the reveal flag in a zone where the customer is visible; audited (D61). */
  async reveal(ctx: AuthContext, id: string): Promise<CustomerContact> {
    const repo = this.deps.db.repo;
    const c = await repo.find(scopeOf(ctx, 'customers:view'), id);
    if (!c) throw notFound();
    let zoneId: string | null;
    if (ctx.isSuperAdmin) zoneId = await repo.latestZone(id);
    else {
      const zones = await repo.zonesOfCustomer(id, scopeOf(ctx, 'customers:view'));
      zoneId = zones.find((z) => ctx.limitsByZone.get(z)?.canReveal) ?? null;
      if (!zoneId) throw forbidden();
    }
    const hit = await this.deps.limiter.hit(
      `customer-reveal:${ctx.userId}`,
      CUSTOMER_REVEALS_PER_HOUR,
      3600,
    );
    if (!hit.allowed)
      throw new AppError('RATE_LIMITED', 'Too many reveals. Try again later.', undefined, {
        'Retry-After': String(Math.max(1, hit.retryAfterSec)),
      });
    await this.deps.db.transaction((tx) =>
      this.audit(tx, c, zoneId, 'customer.contact_revealed', undefined, undefined),
    );
    return { phone: c.phone, email: c.email };
  }

  /** D28: source ADMIN, unique phone, no login; the first address's zone makes the customer visible there (D25). */
  async create(ctx: AuthContext, input: CustomerCreateInput): Promise<CustomerDetail> {
    const zoneId = input.address.zoneId;
    if (!ctx.isSuperAdmin) {
      if (!ctx.assignedZoneIds.includes(zoneId)) throw notFound();
      if (!can(ctx, 'customers:add', zoneId)) throw forbidden();
    }
    if (!(await this.deps.db.repo.zoneExists(zoneId))) throw notFound();
    const id = uuidv7();
    const created = await this.deps.db.transaction(async (tx) => {
      if (await tx.repo.phoneTaken(input.phone)) throw phoneTaken();
      await tx.repo.insert({
        id,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        createdBy: ctx.userId,
        address: {
          id: uuidv7(),
          zoneId,
          label: input.address.label ?? null,
          address: input.address.address,
          area: input.address.area ?? null,
          pincode: input.address.pincode ?? null,
        },
      });
      const c = await tx.repo.find('ALL', id);
      if (!c) throw notFound();
      await this.audit(tx, c, zoneId, 'customer.created', undefined, auditView(c));
      return c;
    });
    return this.toDetail(ctx, created);
  }

  async update(ctx: AuthContext, id: string, input: CustomerUpdateInput): Promise<CustomerDetail> {
    const { customer, zoneId } = await this.writable(ctx, id, 'customers:edit');
    const after = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      if (input.phone !== undefined && (await tx.repo.phoneTaken(input.phone, id)))
        throw phoneTaken();
      await tx.repo.update(id, input, ctx.userId);
      const c = await tx.repo.find('ALL', id);
      if (!c) throw notFound();
      await this.audit(tx, c, zoneId, 'customer.updated', auditView(customer), auditView(c));
      return c;
    });
    return this.toDetail(ctx, after);
  }

  async block(ctx: AuthContext, id: string, input: CustomerBlockInput): Promise<CustomerDetail> {
    return this.setStatus(ctx, id, 'BLOCKED', input.reason);
  }

  async unblock(
    ctx: AuthContext,
    id: string,
    input: CustomerUnblockInput,
  ): Promise<CustomerDetail> {
    return this.setStatus(ctx, id, 'ACTIVE', input.reason);
  }

  private async setStatus(
    ctx: AuthContext,
    id: string,
    to: 'BLOCKED' | 'ACTIVE',
    reason: string | undefined,
  ): Promise<CustomerDetail> {
    const { zoneId } = await this.writable(ctx, id, 'customers:status');
    const after = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const current = await tx.repo.find('ALL', id);
      if (!current) throw notFound();
      if (to === 'BLOCKED' ? current.status === 'BLOCKED' : current.status !== 'BLOCKED')
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          to === 'BLOCKED' ? 'The customer is already blocked' : 'The customer is not blocked',
        );
      await tx.repo.update(id, { status: to }, ctx.userId);
      const c = await tx.repo.find('ALL', id);
      if (!c) throw notFound();
      await this.audit(
        tx,
        c,
        zoneId,
        to === 'BLOCKED' ? 'customer.blocked' : 'customer.unblocked',
        { status: current.status },
        { status: c.status },
        reason,
      );
      return c;
    });
    return this.toDetail(ctx, after);
  }

  /**
   * Visible to the member (else 404); a zone among the customer's visible zones where the member holds `key` (else 403).
   * That zone is the audit zone (D63); a Super Admin's is the latest order or address zone.
   */
  private async writable(
    ctx: AuthContext,
    id: string,
    key: PermissionKey,
  ): Promise<{ customer: CustomerRecord; zoneId: string | null }> {
    const repo = this.deps.db.repo;
    const customer = await repo.find(scopeOf(ctx, 'customers:view'), id);
    if (!customer) throw notFound();
    if (ctx.isSuperAdmin) return { customer, zoneId: await repo.latestZone(id) };
    const zones = await repo.zonesOfCustomer(id, scopeOf(ctx, 'customers:view'));
    const zoneId = zones.find((z) => can(ctx, key, z));
    if (!zoneId) throw forbidden();
    return { customer, zoneId };
  }

  private audit(
    tx: CustomersTx,
    c: CustomerRecord,
    zoneId: string | null,
    action: AuditActionKey,
    before: unknown,
    after: unknown,
    note?: string,
  ): Promise<void> {
    return record(tx.audit, {
      module: 'customers',
      action,
      entity: { type: 'customer', id: c.id, label: c.name, zoneId },
      before,
      after,
      ...(note ? { note } : {}),
    });
  }

  private async toDetail(ctx: AuthContext, c: CustomerRecord): Promise<CustomerDetail> {
    const repo = this.deps.db.repo;
    const scope = scopeOf(ctx, 'customers:view');
    const [figures, addresses, orders] = await Promise.all([
      repo.figures(scope, [c.id]),
      repo.addresses(scope, c.id),
      repo.recentOrders(scope, c.id),
    ]);
    return {
      ...listItem(c, figures.get(c.id) ?? NO_FIGURES),
      walletBalancePaise: c.walletBalance,
      updatedAt: c.updatedAt.toISOString(),
      addresses,
      recentOrders: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        zone: o.zone,
        status: o.status,
        totalPaise: o.total,
        placedAt: o.placedAt.toISOString(),
      })),
    };
  }
}

function listItem(c: CustomerRecord, f: CustomerFigures): CustomerListItem {
  return {
    id: c.id,
    name: c.name,
    phone: maskPhone(c.phone),
    email: c.email === null ? null : maskEmail(c.email),
    status: c.status,
    source: c.source,
    zones: f.zones,
    orderCount: f.orderCount,
    totalSpentPaise: f.totalSpent,
    lastOrderAt: f.lastOrderAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** What the audit trail keeps (phone and email are masked by the redaction policy). */
const auditView = (c: CustomerRecord) => ({
  name: c.name,
  phone: c.phone,
  email: c.email,
  status: c.status,
});
