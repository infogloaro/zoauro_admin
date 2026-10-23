import {
  LOCKED_PROMOTION_STATUSES,
  OPEN_PROMOTION_STATUSES,
  offerRuleProblems,
  type AuditActionKey,
  type Offer,
  type OfferCreateInput,
  type OfferDecisionInput,
  type OfferListQuery,
  type OfferListResponse,
  type OfferPaymentMethod,
  type OfferReasonInput,
  type OfferRedemptionListQuery,
  type OfferRedemptionListResponse,
  type OfferRules,
  type OfferUpdateInput,
  type PermissionKey,
  type PromotionStatus,
} from '@zoauro/shared';
import { maskPhone, record, runAsSystem, uuidv7 } from '../../lib/audit';
import { assertCanWrite, can, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError, type ErrorDetail } from '../../lib/errors';
import { decidedRows, statusChangedRows } from './offers.events';
import type { OfferRow, OfferWrite, OffersDatabase, OffersTx } from './offers.repository';

// Offers review and management (D179, D182 F1–F5, doc 60 §10.6; gaps D199–D204, doc 03).
// Who may do what (on top of the route guard, which checks the action somewhere):
//   - an offer's zones decide: every write needs the action in EVERY zone of the offer (404 for an unassigned zone, 403
//     for a missing action, doc 04 §4); a PLATFORM offer (every zone) is written by Super Admins only;
//   - the approver is never the requester; an offer a Zonal Admin asked for is approved by a Super Admin (F1, D94); an
//     offer from the vendor app (intake pass) by a zone admin with offers:status there; a Super Admin's own offer is
//     scheduled on submit;
//   - SHARED funding and its vendor share are Super Admin only (F2, D199);
//   - once SCHEDULED, ACTIVE or PAUSED the terms are fixed (D204) except three Super Admin changes: budget up, total
//     uses up, end date earlier.
// The 60 s sweep (worker) starts SCHEDULED offers and ends those past their end date.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = (m = 'You do not have permission to do this') => new AppError('FORBIDDEN', m);
const badState = (m: string) => new AppError('INVALID_STATE_TRANSITION', m);
const invalid = (details: ErrorDetail[], m = 'Check the highlighted fields') =>
  new AppError('VALIDATION_ERROR', m, details);

const DELETABLE: readonly PromotionStatus[] = ['DRAFT', 'REJECTED', 'CANCELLED', 'EXPIRED'];
const SWEEP_BATCH = 200;
const HOUR = 3_600_000;

export interface OffersDeps {
  db: OffersDatabase;
  clock: () => Date;
  /** settings offers.rules (platform-wide) */
  rules: () => Promise<OfferRules>;
}

export class OffersService {
  constructor(private readonly deps: OffersDeps) {}

  // ---- reads ----------------------------------------------------------------------------------------------------------

  async list(ctx: AuthContext, q: OfferListQuery): Promise<OfferListResponse> {
    const { rows, total, counts } = await this.deps.db.repo.list(ctx, q);
    return {
      data: await this.dtos(ctx, rows),
      meta: { page: q.page, pageSize: q.pageSize, total, counts },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<Offer> {
    const o = await this.deps.db.repo.offer(ctx, id);
    if (!o) throw notFound();
    return (await this.dtos(ctx, [o]))[0] as Offer;
  }

  async redemptions(
    ctx: AuthContext,
    id: string,
    q: OfferRedemptionListQuery,
  ): Promise<OfferRedemptionListResponse> {
    if (!(await this.deps.db.repo.offer(ctx, id))) throw notFound();
    const s = zonesFor(ctx, 'offers:view');
    const { rows, total } = await this.deps.db.repo.redemptions(
      id,
      q,
      s.kind === 'ALL' ? 'ALL' : s.zoneIds,
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        order: { id: r.order.id, orderNo: r.order.orderNo },
        zone: r.zone,
        customer: { id: r.customer.id, name: r.customer.name, phone: maskPhone(r.customer.phone) },
        discountPaise: r.discountPaise,
        vendorPaise: r.vendorPaise,
        platformPaise: r.platformPaise,
        status: r.status,
        appliedAt: r.appliedAt.toISOString(),
        reversedAt: r.reversedAt?.toISOString() ?? null,
      })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  // ---- writes ---------------------------------------------------------------------------------------------------------

  async create(ctx: AuthContext, input: OfferCreateInput): Promise<Offer> {
    let zoneIds: string[] = [];
    let restaurantId: string | null = null;
    let homemakerId: string | null = null;
    if (input.scope === 'PLATFORM') {
      if (!ctx.isSuperAdmin) throw forbidden('Only a Super Admin creates an offer for every zone');
    } else if (input.scope === 'ZONE') {
      zoneIds = [...new Set(input.zoneIds)];
      for (const z of zoneIds) assertCanWrite(ctx, 'offers:add', z);
      const known = await this.deps.db.repo.zones(zoneIds);
      if (known.length !== zoneIds.length)
        throw invalid([{ field: 'zoneIds', issue: 'unknown_zone' }], 'A zone does not exist');
    } else {
      const ref = input.vendor;
      if (!ref) throw invalid([{ field: 'vendor', issue: 'required' }]);
      const v = await this.deps.db.repo.vendor(ref.type, ref.id);
      if (!v) throw notFound();
      if (v.zoneId === null) throw new AppError('CONFLICT', 'Assign the vendor to a zone first');
      assertCanWrite(ctx, 'offers:add', v.zoneId);
      zoneIds = [v.zoneId];
      if (ref.type === 'RESTAURANT') restaurantId = v.id;
      else homemakerId = v.id;
    }
    const fundedBy = input.fundedBy ?? (input.scope === 'VENDOR' ? 'VENDOR' : 'PLATFORM');
    if (fundedBy === 'SHARED' && !ctx.isSuperAdmin)
      throw forbidden('Only a Super Admin shares the cost with vendors');
    const terms = {
      type: input.type,
      value: input.value,
      maxDiscountPaise: input.maxDiscountPaise ?? null,
      perCustomerLimit: input.perCustomerLimit,
      validFrom: new Date(input.validFrom),
      validTo: new Date(input.validTo),
    };
    await this.checkTerms(terms);
    const code = input.code ?? null;
    if (code && (await this.deps.db.repo.codeTaken(code)))
      throw new AppError('CONFLICT', 'Another offer uses this code', [
        { field: 'code', issue: 'taken' },
      ]);
    const id = uuidv7();
    const row = {
      id,
      scope: input.scope,
      restaurantId,
      homemakerId,
      zoneIds,
      code,
      title: input.title,
      description: input.description ?? null,
      ...terms,
      minOrderPaise: input.minOrderPaise,
      newCustomersOnly: input.newCustomersOnly,
      paymentMethods: [...input.paymentMethods],
      usageLimit: input.usageLimit ?? null,
      budgetPaise: input.budgetPaise ?? null,
      fundedBy,
      vendorSharePct: fundedBy === 'SHARED' ? (input.vendorSharePct ?? null) : null,
      requestedBy: ctx.userId,
      requestedBySuperAdmin: ctx.isSuperAdmin,
    };
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.insert(row);
      await audit(tx, 'offer.created', id, input.title, zoneIds, undefined, auditView(row));
    });
    return this.detail(ctx, id);
  }

  async update(ctx: AuthContext, id: string, input: OfferUpdateInput): Promise<Offer> {
    const { version, ...fields } = input;
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    ) as Omit<OfferUpdateInput, 'version'>;
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, version);
      let w: OfferWrite;
      if (o.status === 'DRAFT' || o.status === 'REJECTED') {
        this.assertWriteAll(ctx, 'offers:edit', o);
        if (changed.vendorSharePct !== undefined) {
          if (!ctx.isSuperAdmin) throw forbidden('Only a Super Admin sets the vendor share');
          if (o.fundedBy !== 'SHARED')
            throw invalid([{ field: 'vendorSharePct', issue: 'not_shared' }]);
        }
        const merged = {
          type: changed.type ?? o.type,
          value: changed.value ?? o.value,
          maxDiscountPaise:
            changed.maxDiscountPaise !== undefined ? changed.maxDiscountPaise : o.maxDiscountPaise,
          perCustomerLimit: changed.perCustomerLimit ?? o.perCustomerLimit,
          validFrom: changed.validFrom ? new Date(changed.validFrom) : o.validFrom,
          validTo: changed.validTo ? new Date(changed.validTo) : o.validTo,
        };
        shape(merged);
        await this.checkTerms(merged);
        const code = changed.code !== undefined ? changed.code : o.code;
        if (code && code !== o.code && (await tx.repo.codeTaken(code, o.id)))
          throw new AppError('CONFLICT', 'Another offer uses this code', [
            { field: 'code', issue: 'taken' },
          ]);
        w = {
          ...(changed.code !== undefined ? { code: changed.code ?? null } : {}),
          ...(changed.title !== undefined ? { title: changed.title } : {}),
          ...(changed.description !== undefined
            ? { description: changed.description ?? null }
            : {}),
          type: merged.type,
          value: merged.value,
          maxDiscountPaise: merged.maxDiscountPaise ?? null,
          perCustomerLimit: merged.perCustomerLimit,
          validFrom: merged.validFrom,
          validTo: merged.validTo,
          ...(changed.minOrderPaise !== undefined ? { minOrderPaise: changed.minOrderPaise } : {}),
          ...(changed.newCustomersOnly !== undefined
            ? { newCustomersOnly: changed.newCustomersOnly }
            : {}),
          ...(changed.paymentMethods !== undefined
            ? { paymentMethods: [...changed.paymentMethods] }
            : {}),
          ...(changed.usageLimit !== undefined ? { usageLimit: changed.usageLimit ?? null } : {}),
          ...(changed.budgetPaise !== undefined
            ? { budgetPaise: changed.budgetPaise ?? null }
            : {}),
          ...(changed.vendorSharePct !== undefined
            ? { vendorSharePct: changed.vendorSharePct }
            : {}),
          // D204 / doc 10 §7: editing a rejected offer makes it a draft again
          ...(o.status === 'REJECTED' ? { status: 'DRAFT' as const, statusReason: null } : {}),
        };
      } else if (LOCKED_PROMOTION_STATUSES.includes(o.status)) {
        if (!ctx.isSuperAdmin)
          throw forbidden('Once approved, only a Super Admin changes an offer');
        w = this.lockedChange(o, changed);
      } else {
        throw badState(`A ${label(o.status)} offer cannot be changed`);
      }
      await tx.repo.update(id, w, ctx.userId);
      const after = await tx.repo.byId(id);
      await audit(
        tx,
        'offer.updated',
        id,
        o.title,
        o.zoneIds,
        auditView(o),
        after ? auditView(after) : undefined,
      );
    });
    return this.detail(ctx, id);
  }

  async submit(ctx: AuthContext, id: string, version: number): Promise<Offer> {
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, version);
      this.assertWriteAll(ctx, 'offers:edit', o);
      if (o.status !== 'DRAFT') throw badState(`A ${label(o.status)} offer cannot be sent`);
      await this.checkTerms(o);
      const now = this.deps.clock();
      // a Super Admin's own offer needs nobody's approval (D182 §10.6)
      const to: PromotionStatus = !ctx.isSuperAdmin
        ? 'PENDING_APPROVAL'
        : o.validFrom <= now
          ? 'ACTIVE'
          : 'SCHEDULED';
      await tx.repo.update(id, { status: to, statusReason: null, submittedAt: now }, ctx.userId);
      await tx.repo.insertOutbox(statusChangedRows(o, to, o.version + 1, admin(ctx), now));
      await audit(
        tx,
        'offer.submitted',
        id,
        o.title,
        o.zoneIds,
        { status: o.status },
        { status: to },
      );
    });
    return this.detail(ctx, id);
  }

  async approve(ctx: AuthContext, id: string, input: OfferDecisionInput): Promise<Offer> {
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, input.version);
      this.assertApprover(ctx, o);
      const now = this.deps.clock();
      if (o.validTo <= now)
        throw new AppError('CONFLICT', 'This offer has already ended; reject it instead');
      const to: PromotionStatus = o.validFrom <= now ? 'ACTIVE' : 'SCHEDULED';
      await tx.repo.update(
        id,
        {
          status: to,
          statusReason: null,
          decidedBy: ctx.userId,
          decidedAt: now,
          decisionReason: input.reason ?? null,
        },
        ctx.userId,
      );
      await tx.repo.insertOutbox([
        ...statusChangedRows(o, to, o.version + 1, admin(ctx), now),
        ...decidedRows(o, 'APPROVED', input.reason ?? null, o.version + 1, admin(ctx), now),
      ]);
      await audit(
        tx,
        'offer.approved',
        id,
        o.title,
        o.zoneIds,
        { status: o.status },
        { status: to, reason: input.reason ?? null },
      );
    });
    return this.detail(ctx, id);
  }

  async reject(ctx: AuthContext, id: string, input: OfferReasonInput): Promise<Offer> {
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, input.version);
      this.assertApprover(ctx, o);
      await tx.repo.update(
        id,
        {
          status: 'REJECTED',
          statusReason: input.reason,
          decidedBy: ctx.userId,
          decidedAt: this.deps.clock(),
          decisionReason: input.reason,
        },
        ctx.userId,
      );
      await tx.repo.insertOutbox(
        decidedRows(o, 'REJECTED', input.reason, o.version + 1, admin(ctx), this.deps.clock()),
      );
      await audit(
        tx,
        'offer.rejected',
        id,
        o.title,
        o.zoneIds,
        { status: o.status },
        { status: 'REJECTED', reason: input.reason },
      );
    });
    return this.detail(ctx, id);
  }

  async pause(ctx: AuthContext, id: string, input: OfferReasonInput): Promise<Offer> {
    return this.move(ctx, id, input, 'ACTIVE', 'PAUSED', 'offer.paused');
  }

  async resume(ctx: AuthContext, id: string, input: OfferReasonInput): Promise<Offer> {
    return this.move(ctx, id, input, 'PAUSED', 'ACTIVE', 'offer.resumed', (o) => {
      const now = this.deps.clock();
      if (o.validTo <= now) throw new AppError('CONFLICT', 'This offer has ended');
      if (o.budgetPaise !== null && o.spentPaise >= o.budgetPaise)
        throw new AppError('CONFLICT', 'The budget is spent; raise it first');
      if (o.usageLimit !== null && o.usedCount >= o.usageLimit)
        throw new AppError('CONFLICT', 'Every use is taken; raise the limit first');
    });
  }

  async cancel(ctx: AuthContext, id: string, input: OfferReasonInput): Promise<Offer> {
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, input.version);
      this.assertWriteAll(ctx, 'offers:status', o);
      if (!OPEN_PROMOTION_STATUSES.includes(o.status))
        throw badState(`A ${label(o.status)} offer cannot be cancelled`);
      await tx.repo.update(id, { status: 'CANCELLED', statusReason: input.reason }, ctx.userId);
      await tx.repo.insertOutbox(
        statusChangedRows(o, 'CANCELLED', o.version + 1, admin(ctx), this.deps.clock()),
      );
      await audit(
        tx,
        'offer.cancelled',
        id,
        o.title,
        o.zoneIds,
        { status: o.status },
        { status: 'CANCELLED', reason: input.reason },
      );
    });
    return this.detail(ctx, id);
  }

  /** Super Admin only (offers:delete is never grantable): an offer nobody has used, once it is no longer open. */
  async remove(ctx: AuthContext, id: string, version: number): Promise<void> {
    if (!ctx.isSuperAdmin) throw forbidden();
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, version);
      if (!DELETABLE.includes(o.status)) throw badState('Cancel the offer before deleting it');
      if (o.usedCount > 0 || (await tx.repo.hasRedemptions(id)))
        throw new AppError('CONFLICT', 'Customers have used this offer; it stays on record');
      await tx.repo.update(id, { deletedAt: this.deps.clock() }, ctx.userId);
      await audit(tx, 'offer.deleted', id, o.title, o.zoneIds, auditView(o), undefined);
    });
  }

  /**
   * The schedule (worker, every 60 s): SCHEDULED → ACTIVE once started, ACTIVE or PAUSED → EXPIRED once ended.
   * Idempotent: each row is locked and checked again, so an overlapping or repeated run moves nothing twice.
   */
  async sweep(): Promise<number> {
    return runAsSystem('offers schedule sweep', async () => {
      const now = this.deps.clock();
      const due = await this.deps.db.repo.due(now, SWEEP_BATCH);
      let moved = 0;
      for (const d of due) {
        moved += await this.deps.db.transaction(async (tx) => {
          await tx.repo.lock(d.id);
          const o = await tx.repo.byId(d.id);
          if (!o) return 0;
          const to: PromotionStatus | null =
            (o.status === 'ACTIVE' || o.status === 'PAUSED') && o.validTo <= now
              ? 'EXPIRED'
              : o.status === 'SCHEDULED' && o.validTo <= now
                ? 'EXPIRED'
                : o.status === 'SCHEDULED' && o.validFrom <= now
                  ? 'ACTIVE'
                  : null;
          if (!to) return 0;
          await tx.repo.update(
            o.id,
            { status: to, statusReason: to === 'EXPIRED' ? 'Ended on its end date' : null },
            null,
          );
          await tx.repo.insertOutbox(statusChangedRows(o, to, o.version + 1, SYSTEM, now));
          await audit(
            tx,
            'job.offers_swept',
            o.id,
            o.title,
            o.zoneIds,
            { status: o.status },
            { status: to },
          );
          return 1;
        });
      }
      return moved;
    });
  }

  // ---- helpers --------------------------------------------------------------------------------------------------------

  private async move(
    ctx: AuthContext,
    id: string,
    input: OfferReasonInput,
    from: PromotionStatus,
    to: PromotionStatus,
    action: AuditActionKey,
    guard?: (o: OfferRow) => void,
  ): Promise<Offer> {
    await this.deps.db.transaction(async (tx) => {
      const o = await this.current(ctx, tx, id, input.version);
      this.assertWriteAll(ctx, 'offers:status', o);
      if (o.status !== from) throw badState(`A ${label(o.status)} offer cannot be ${label(to)}`);
      guard?.(o);
      await tx.repo.update(
        id,
        { status: to, statusReason: to === 'PAUSED' ? input.reason : null },
        ctx.userId,
      );
      await tx.repo.insertOutbox(
        statusChangedRows(o, to, o.version + 1, admin(ctx), this.deps.clock()),
      );
      await audit(
        tx,
        action,
        id,
        o.title,
        o.zoneIds,
        { status: o.status },
        { status: to, reason: input.reason },
      );
    });
    return this.detail(ctx, id);
  }

  /** Locks the row, then reads it in the caller's scope (404) at its version (409). */
  private async current(
    ctx: AuthContext,
    tx: OffersTx,
    id: string,
    version: number,
  ): Promise<OfferRow> {
    await tx.repo.lock(id);
    const o = await tx.repo.offer(ctx, id);
    if (!o) throw notFound();
    if (o.version !== version)
      throw new AppError(
        'STALE_VERSION',
        'The offer changed since it was read',
        undefined,
        undefined,
        { current: { status: o.status, version: o.version } },
      );
    return o;
  }

  /** Every zone of the offer: 404 unassigned, 403 missing action. A PLATFORM offer: Super Admin only. */
  private assertWriteAll(ctx: AuthContext, key: PermissionKey, o: Pick<OfferRow, 'zoneIds'>) {
    if (ctx.isSuperAdmin) return;
    if (o.zoneIds.length === 0)
      throw forbidden('Only a Super Admin changes an offer for every zone');
    for (const z of o.zoneIds) assertCanWrite(ctx, key, z);
  }

  private writesAll(ctx: AuthContext, key: PermissionKey, o: Pick<OfferRow, 'zoneIds'>): boolean {
    if (ctx.isSuperAdmin) return true;
    return o.zoneIds.length > 0 && o.zoneIds.every((z) => can(ctx, key, z));
  }

  private assertApprover(ctx: AuthContext, o: OfferRow) {
    if (o.status !== 'PENDING_APPROVAL')
      throw badState(`A ${label(o.status)} offer is not waiting for approval`);
    if (o.requestedBy === ctx.userId) throw forbidden('You cannot decide your own offer');
    if (ctx.isSuperAdmin) return;
    // a Zonal Admin's offer (source ADMIN) is decided by a Super Admin (F1, D94); a vendor's (APP) by its zone's admin
    if (o.source !== 'APP') throw forbidden('A Super Admin decides this offer');
    this.assertWriteAll(ctx, 'offers:status', o);
  }

  private canApprove(ctx: AuthContext, o: OfferRow): boolean {
    if (o.status !== 'PENDING_APPROVAL' || o.requestedBy === ctx.userId) return false;
    return ctx.isSuperAdmin || (o.source === 'APP' && this.writesAll(ctx, 'offers:status', o));
  }

  /** D204: SCHEDULED, ACTIVE or PAUSED — budget up, total uses up, end date earlier; nothing else. */
  private lockedChange(o: OfferRow, changed: Omit<OfferUpdateInput, 'version'>): OfferWrite {
    const allowed = new Set(['budgetPaise', 'usageLimit', 'validTo']);
    const other = Object.keys(changed).filter((k) => !allowed.has(k));
    if (other.length > 0)
      throw badState(
        'Once approved, only the budget, the total uses and an earlier end date can change; cancel and create a new offer for anything else',
      );
    const w: OfferWrite = {};
    const details: ErrorDetail[] = [];
    if (changed.budgetPaise !== undefined) {
      const b = changed.budgetPaise;
      if (b === null) w.budgetPaise = null;
      else if (o.budgetPaise !== null && b < o.budgetPaise)
        details.push({ field: 'budgetPaise', issue: 'only_raise' });
      else if (b <= o.spentPaise) details.push({ field: 'budgetPaise', issue: 'below_spent' });
      else w.budgetPaise = b;
    }
    if (changed.usageLimit !== undefined) {
      const u = changed.usageLimit;
      if (u === null) w.usageLimit = null;
      else if (o.usageLimit !== null && u < o.usageLimit)
        details.push({ field: 'usageLimit', issue: 'only_raise' });
      else if (u <= o.usedCount) details.push({ field: 'usageLimit', issue: 'below_used' });
      else w.usageLimit = u;
    }
    if (changed.validTo !== undefined) {
      const t = new Date(changed.validTo);
      if (t >= o.validTo) details.push({ field: 'validTo', issue: 'only_earlier' });
      else if (t <= this.deps.clock() || t <= o.validFrom)
        details.push({ field: 'validTo', issue: 'in_the_past' });
      else w.validTo = t;
    }
    if (details.length > 0) throw invalid(details);
    return w;
  }

  /** offers.rules (D182) and an end in the future. */
  private async checkTerms(t: {
    type: OfferRow['type'];
    value: number;
    perCustomerLimit: number;
    validFrom: Date;
    validTo: Date;
  }) {
    const problems = offerRuleProblems(
      {
        type: t.type,
        value: t.value,
        perCustomerLimit: t.perCustomerLimit,
        validFrom: t.validFrom.toISOString(),
        validTo: t.validTo.toISOString(),
      },
      await this.deps.rules(),
    );
    if (t.validTo <= this.deps.clock()) problems['validTo'] ??= 'The end date has passed';
    const keys = Object.keys(problems);
    if (keys.length > 0)
      throw invalid(
        keys.map((k) => ({ field: k, issue: problems[k] ?? 'invalid' })),
        Object.values(problems).join('; '),
      );
  }

  private async dtos(ctx: AuthContext, rows: OfferRow[]): Promise<Offer[]> {
    const [zones, names, rules] = await Promise.all([
      this.deps.db.repo.zones([...new Set(rows.flatMap((r) => r.zoneIds))]),
      this.deps.db.repo.userNames([
        ...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy].filter(isString))),
      ]),
      this.deps.rules(),
    ]);
    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const now = this.deps.clock().getTime();
    const person = (id: string | null) => (id ? { id, name: names.get(id) ?? 'Unknown' } : null);
    return rows.map((o) => {
      const editable = o.status === 'DRAFT' || o.status === 'REJECTED';
      return {
        id: o.id,
        scope: o.scope,
        zones: o.zoneIds.flatMap((z) => {
          const zone = zoneById.get(z);
          return zone ? [zone] : [];
        }),
        vendor: o.restaurantId
          ? { type: 'RESTAURANT' as const, id: o.restaurantId, name: o.restaurant?.name ?? '' }
          : o.homemakerId
            ? { type: 'HOMEMAKER' as const, id: o.homemakerId, name: o.homemaker?.name ?? '' }
            : null,
        code: o.code,
        title: o.title,
        description: o.description,
        type: o.type,
        value: o.value,
        maxDiscountPaise: o.maxDiscountPaise,
        minOrderPaise: o.minOrderPaise,
        newCustomersOnly: o.newCustomersOnly,
        paymentMethods: o.paymentMethods as OfferPaymentMethod[],
        perCustomerLimit: o.perCustomerLimit,
        usageLimit: o.usageLimit,
        usedCount: o.usedCount,
        budgetPaise: o.budgetPaise,
        spentPaise: o.spentPaise,
        fundedBy: o.fundedBy,
        vendorSharePct: o.vendorSharePct,
        validFrom: o.validFrom.toISOString(),
        validTo: o.validTo.toISOString(),
        status: o.status,
        statusReason: o.statusReason,
        source: o.source === 'APP' ? 'APP' : 'ADMIN',
        requestedBy: person(o.requestedBy),
        requestedBySuperAdmin: o.requestedBySuperAdmin,
        submittedAt: o.submittedAt?.toISOString() ?? null,
        decidedBy: person(o.decidedBy),
        decidedAt: o.decidedAt?.toISOString() ?? null,
        decisionReason: o.decisionReason,
        approvalOverdue:
          o.status === 'PENDING_APPROVAL' &&
          o.submittedAt !== null &&
          now - o.submittedAt.getTime() > rules.approvalAgeWarningHours * HOUR,
        can: {
          edit:
            (editable && this.writesAll(ctx, 'offers:edit', o)) ||
            (LOCKED_PROMOTION_STATUSES.includes(o.status) && ctx.isSuperAdmin),
          submit: o.status === 'DRAFT' && this.writesAll(ctx, 'offers:edit', o),
          approve: this.canApprove(ctx, o),
          pause: o.status === 'ACTIVE' && this.writesAll(ctx, 'offers:status', o),
          resume: o.status === 'PAUSED' && this.writesAll(ctx, 'offers:status', o),
          cancel:
            OPEN_PROMOTION_STATUSES.includes(o.status) && this.writesAll(ctx, 'offers:status', o),
          delete: ctx.isSuperAdmin && DELETABLE.includes(o.status) && o.usedCount === 0,
        },
        version: o.version,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      };
    });
  }
}

const isString = (v: string | null): v is string => v !== null;

const admin = (ctx: AuthContext) => ({ type: 'ADMIN' as const, id: ctx.userId });
const SYSTEM = { type: 'SYSTEM' as const, id: null };

const label = (s: PromotionStatus) => s.toLowerCase().replace('_', ' ');

/** The merged terms of an edit must still make sense together (the schema checks each request alone). */
function shape(t: { type: OfferRow['type']; value: number; maxDiscountPaise: number | null }) {
  const d: ErrorDetail[] = [];
  if (t.type === 'PERCENT' && (t.value < 1 || t.value > 100))
    d.push({ field: 'value', issue: 'percent_1_100' });
  if (t.type === 'FLAT' && t.value < 100) d.push({ field: 'value', issue: 'flat_min' });
  if (t.type === 'FREE_DELIVERY' && t.value !== 0) d.push({ field: 'value', issue: 'must_be_0' });
  if (t.type !== 'PERCENT' && t.maxDiscountPaise !== null)
    d.push({ field: 'maxDiscountPaise', issue: 'percent_only' });
  if (d.length > 0) throw invalid(d);
}

function audit(
  tx: OffersTx,
  action: AuditActionKey,
  id: string,
  label: string,
  zoneIds: readonly string[],
  before: unknown,
  after: unknown,
) {
  return record(tx.audit, {
    module: action.startsWith('job.') ? 'system' : 'offers',
    action,
    // one zone: the zone's Activity shows it; several or every zone: global (Super Admin)
    entity: {
      type: 'offer',
      id,
      label,
      zoneId: zoneIds.length === 1 ? (zoneIds[0] ?? null) : null,
    },
    before,
    after,
  });
}

function auditView(o: {
  code: string | null;
  title: string;
  type: string;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  perCustomerLimit: number;
  usageLimit: number | null;
  budgetPaise: number | null;
  fundedBy: string;
  vendorSharePct: number | null;
  validFrom: Date;
  validTo: Date;
  zoneIds: readonly string[];
}) {
  return {
    code: o.code,
    title: o.title,
    type: o.type,
    value: o.value,
    maxDiscountPaise: o.maxDiscountPaise,
    minOrderPaise: o.minOrderPaise,
    perCustomerLimit: o.perCustomerLimit,
    usageLimit: o.usageLimit,
    budgetPaise: o.budgetPaise,
    fundedBy: o.fundedBy,
    vendorSharePct: o.vendorSharePct,
    validFrom: o.validFrom.toISOString(),
    validTo: o.validTo.toISOString(),
    zoneIds: o.zoneIds,
  };
}
