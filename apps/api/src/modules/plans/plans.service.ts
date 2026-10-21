import type {
  AuditActionKey,
  PlanVendorType,
  VendorPlan,
  VendorPlanCreateInput,
  VendorPlanListQuery,
  VendorPlanListResponse,
  VendorPlanStatusInput,
  VendorPlanSubscribeInput,
  VendorPlanSubscription,
  VendorPlanSubscriptionListQuery,
  VendorPlanSubscriptionListResponse,
  VendorPlanUpdateInput,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { PlanRow, PlansDatabase, PlansTx, SubscriptionRow } from './plans.repository';

// ZOAURO → vendor plans (D179 section 4a, D182 P1-P4, D188 demo scope). Catalogue writes: Super Admin only (`plans`
// is view-grantable only, so the guard already refuses a Zonal Admin; the service checks again). Zonal Admins read the
// active catalogue and their zones' subscribers. No invoices, renewals or billing yet: a subscription is a record of
// which plan a vendor is on, with the price and plan as they were when it started.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');
const DAY = 86_400_000;
const CYCLE_DAYS = { MONTHLY: 30, QUARTERLY: 91, YEARLY: 365 } as const;

export class PlansService {
  constructor(private readonly deps: { db: PlansDatabase; clock: () => Date }) {}

  async list(ctx: AuthContext, q: VendorPlanListQuery): Promise<VendorPlanListResponse> {
    const { rows, total } = await this.deps.db.repo.listPlans(q, !ctx.isSuperAdmin);
    return {
      data: await this.dtos(ctx, rows),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<VendorPlan> {
    const p = await this.deps.db.repo.plan(id);
    if (!p || (!ctx.isSuperAdmin && p.status !== 'ACTIVE')) throw notFound();
    return (await this.dtos(ctx, [p]))[0] as VendorPlan;
  }

  async create(ctx: AuthContext, input: VendorPlanCreateInput): Promise<VendorPlan> {
    if (!ctx.isSuperAdmin) throw forbidden();
    if (await this.deps.db.repo.codeTaken(input.code))
      throw new AppError('CONFLICT', 'A plan with this code exists', [
        { field: 'code', issue: 'taken' },
      ]);
    const id = uuidv7();
    const { features, ...fields } = input;
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.insertPlan({ ...fields, id, createdBy: ctx.userId }, features);
      await audit(tx, 'vendor_plan.created', id, input.name, undefined, { ...fields, features });
    });
    return this.detail(ctx, id);
  }

  async update(ctx: AuthContext, id: string, input: VendorPlanUpdateInput): Promise<VendorPlan> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const { version, features, ...fields } = input;
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockPlan(id);
      const before = await this.current(tx, id, version);
      await tx.repo.updatePlan(id, fields, ctx.userId, features);
      const after = await tx.repo.plan(id);
      await audit(
        tx,
        'vendor_plan.updated',
        id,
        before.name,
        view(before),
        after ? view(after) : undefined,
      );
    });
    return this.detail(ctx, id);
  }

  async setStatus(ctx: AuthContext, id: string, input: VendorPlanStatusInput): Promise<VendorPlan> {
    if (!ctx.isSuperAdmin) throw forbidden();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockPlan(id);
      const p = await this.current(tx, id, input.version);
      const ok =
        (p.status === 'DRAFT' && input.status === 'ACTIVE') ||
        (p.status === 'ACTIVE' && input.status === 'RETIRED');
      if (!ok)
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `A ${p.status.toLowerCase()} plan cannot become ${input.status.toLowerCase()}`,
        );
      await tx.repo.updatePlan(id, { status: input.status }, ctx.userId);
      await audit(
        tx,
        input.status === 'ACTIVE' ? 'vendor_plan.activated' : 'vendor_plan.retired',
        id,
        p.name,
        { status: p.status },
        { status: input.status },
      );
    });
    return this.detail(ctx, id);
  }

  async subscriptions(
    ctx: AuthContext,
    planId: string,
    q: VendorPlanSubscriptionListQuery,
  ): Promise<VendorPlanSubscriptionListResponse> {
    await this.detail(ctx, planId); // 404 for a plan the caller cannot see
    const { rows, total } = await this.deps.db.repo.listSubscriptions(ctx, planId, q);
    return { data: rows.map(subDto), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  /** Super Admin: put a vendor on an ACTIVE plan (trial first when the plan has one); one live plan per vendor. */
  async subscribe(
    ctx: AuthContext,
    planId: string,
    input: VendorPlanSubscribeInput,
  ): Promise<VendorPlanSubscription> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const plan = await this.deps.db.repo.plan(planId);
    if (!plan) throw notFound();
    if (plan.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE_TRANSITION', 'Only an active plan takes vendors');
    if (!plan.vendorTypes.includes(input.vendorType))
      throw new AppError('VALIDATION_ERROR', 'This plan is not for this kind of vendor', [
        { field: 'vendorType', issue: 'not_in_plan' },
      ]);
    const vendor = await this.deps.db.repo.vendor(input.vendorType, input.vendorId);
    if (!vendor) throw notFound();
    if (vendor.zoneId === null) throw new AppError('CONFLICT', 'Assign the vendor to a zone first');
    if (plan.zoneIds.length > 0 && !plan.zoneIds.includes(vendor.zoneId))
      throw new AppError('VALIDATION_ERROR', 'This plan is not offered in the vendor’s zone', [
        { field: 'vendorId', issue: 'zone_not_in_plan' },
      ]);
    const now = this.deps.clock();
    const id = uuidv7();
    const zoneId = vendor.zoneId;
    await this.deps.db.transaction(async (tx) => {
      if (await tx.repo.liveSubscriptionOf(input.vendorType, vendor.id))
        throw new AppError('CONFLICT', 'The vendor is already on a plan; cancel it first');
      const trial = plan.trialDays > 0;
      await tx.repo.insertSubscription({
        id,
        planId,
        vendor: { type: input.vendorType, id: vendor.id },
        zoneId,
        status: trial ? 'TRIAL' : 'ACTIVE',
        pricePaise: plan.pricePaise,
        startedAt: now,
        endsAt: new Date(now.getTime() + (trial ? plan.trialDays : CYCLE_DAYS[plan.cycle]) * DAY),
        snapshot: view(plan),
        createdBy: ctx.userId,
      });
      await record(tx.audit, {
        module: 'plans',
        action: 'vendor_plan_subscription.created',
        entity: {
          type: 'vendor_plan_subscription',
          id,
          label: `${vendor.name} → ${plan.code}`,
          zoneId,
        },
        after: {
          plan: plan.code,
          vendorType: input.vendorType,
          vendorId: vendor.id,
          pricePaise: plan.pricePaise,
        },
      });
    });
    const s = await this.deps.db.repo.subscription(ctx, id);
    if (!s) throw notFound();
    return subDto(s);
  }

  async cancel(ctx: AuthContext, id: string, version: number): Promise<VendorPlanSubscription> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const s = await this.deps.db.repo.subscription(ctx, id);
    if (!s) throw notFound();
    if (s.version !== version)
      throw new AppError('STALE_VERSION', 'Changed since it was read', undefined, undefined, {
        current: { status: s.status, version: s.version },
      });
    if (s.status !== 'TRIAL' && s.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE_TRANSITION', 'This subscription has already ended');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.cancelSubscription(id, this.deps.clock(), ctx.userId);
      await record(tx.audit, {
        module: 'plans',
        action: 'vendor_plan_subscription.cancelled',
        entity: {
          type: 'vendor_plan_subscription',
          id,
          label: `${vendorName(s)} → ${s.plan.code}`,
          zoneId: s.zoneId,
        },
        before: { status: s.status },
        after: { status: 'CANCELLED' },
      });
    });
    const after = await this.deps.db.repo.subscription(ctx, id);
    if (!after) throw notFound();
    return subDto(after);
  }

  private async current(tx: PlansTx, id: string, version: number): Promise<PlanRow> {
    const p = await tx.repo.plan(id);
    if (!p) throw notFound();
    if (p.version !== version)
      throw new AppError(
        'STALE_VERSION',
        'The plan changed since it was read',
        undefined,
        undefined,
        { current: { version: p.version } },
      );
    return p;
  }

  private async dtos(ctx: AuthContext, rows: PlanRow[]): Promise<VendorPlan[]> {
    const counts = await this.deps.db.repo.subscriberCounts(
      ctx,
      rows.map((r) => r.id),
    );
    const zones = await this.deps.db.repo.zones([...new Set(rows.flatMap((r) => r.zoneIds))]);
    const byId = new Map(zones.map((z) => [z.id, z]));
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      pricePaise: p.pricePaise,
      cycle: p.cycle,
      trialDays: p.trialDays,
      vendorTypes: p.vendorTypes as PlanVendorType[],
      zones: p.zoneIds.flatMap((z) =>
        byId.has(z) ? [byId.get(z) as { id: string; name: string; code: string }] : [],
      ),
      features: p.features.map((f) => ({
        feature: f.feature as VendorPlan['features'][number]['feature'],
        value: f.value,
      })),
      status: p.status,
      sortOrder: p.sortOrder,
      subscriberCount: counts.get(p.id) ?? 0,
      version: p.version,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }
}

function audit(
  tx: PlansTx,
  action: AuditActionKey,
  id: string,
  label: string,
  before: unknown,
  after: unknown,
) {
  return record(tx.audit, {
    module: 'plans',
    action,
    entity: { type: 'vendor_plan', id, label, zoneId: null },
    before,
    after,
  });
}

function view(p: PlanRow) {
  return {
    code: p.code,
    name: p.name,
    pricePaise: p.pricePaise,
    cycle: p.cycle,
    trialDays: p.trialDays,
    vendorTypes: p.vendorTypes,
    zoneIds: p.zoneIds,
    features: p.features,
  };
}

const vendorName = (s: SubscriptionRow) =>
  s.restaurant?.name ?? s.homemaker?.name ?? s.hotel?.name ?? '';

function subDto(s: SubscriptionRow): VendorPlanSubscription {
  const type: PlanVendorType = s.restaurantId
    ? 'RESTAURANT'
    : s.homemakerId
      ? 'HOMEMAKER'
      : 'HOTEL';
  return {
    id: s.id,
    plan: s.plan,
    vendor: { type, id: s.restaurantId ?? s.homemakerId ?? s.hotelId ?? '', name: vendorName(s) },
    zone: s.zone,
    status: s.status,
    pricePaise: s.pricePaise,
    startedAt: s.startedAt.toISOString(),
    endsAt: s.endsAt?.toISOString() ?? null,
    version: s.version,
  };
}
