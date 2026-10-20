import {
  buildCursorPage,
  MAX_DELIVERY_CHARGE_PAISE,
  pageWindow,
  type CreateZoneInput,
  type DeactivateZoneInput,
  type PatchZoneInput,
  type ZoneDetailQuery,
  type ZoneDto,
  type ZoneListQuery,
  type ZonePincodesInput,
  type AuditActionKey,
  type PutZoneServicesInput,
  type ZoneServiceKind,
  type ZoneServicesResponse,
  ZONE_SERVICE_DEFAULTS,
  ZONE_SERVICE_LABELS,
  ZONE_SERVICES,
  zoneServiceFlags,
} from '@zoauro/shared';
import { noteAuditNoop, record, uuidv7 } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { ImpactService } from './impact.service';
import { assertNoOverlap, initialPincodes, planPincodeChange } from './pincodes.service';
import {
  zoneEventRows,
  zoneInternalEventRow,
  type ZoneChange,
  type ZonesCacheVersion,
} from './zones.events';
import {
  uniqueViolationOn,
  type ZoneChanges,
  type ZonesDatabase,
  type ZonesTx,
} from './zones.repository';

// Zone rules (doc 53 sections 2.1, 2.2, 2.6). Every write is one transaction holding the change, its audit row(s) and
// its two outbox rows (R-ZONE-10); the zones:version cache counter is bumped after the commit. Nothing here ever writes
// to vendors, partners or orders: deactivation only stops new intake, derived from the zone status (R-ZONE-6).

const notFound = () => new AppError('NOT_FOUND', 'Not found');

/** What the audit trail keeps of a zone (no timestamps: they always differ). */
const auditView = (z: ZoneDto) => ({
  name: z.name,
  code: z.code,
  city: z.city,
  state: z.state,
  description: z.description,
  colorHex: z.colorHex,
  status: z.status,
  deliveryChargePaise: z.deliveryChargePaise,
  pincodeFrom: z.pincodeFrom,
  pincodeTo: z.pincodeTo,
  pincodeCount: z.pincodeCount,
});

const stale = (current: ZoneDto) =>
  new AppError(
    'STALE_VERSION',
    'This zone was changed by someone else. Review the newer values and try again',
    [{ field: 'version', issue: 'stale' }],
    undefined,
    { current },
  );

/** A unique index refused the write: a change that bypassed the advisory lock, or a race on name/code. */
function fromUniqueViolation(err: unknown): unknown {
  switch (uniqueViolationOn(err)) {
    case 'serviceable_pincodes_pincode_key':
      return new AppError(
        'PINCODE_OVERLAP',
        'Another change claimed one of these pincodes. Reload and try again',
        [{ field: 'pincodes', issue: 'PINCODE_OVERLAP' }],
        undefined,
        { conflicts: [] },
      );
    case 'zones_code_key':
      return new AppError('ZONE_CODE_TAKEN', 'This code is already used by another zone', [
        { field: 'code', issue: 'ZONE_CODE_TAKEN' },
      ]);
    case 'zones_name_lower_active_key':
      return new AppError('ZONE_NAME_TAKEN', 'Another zone already has this name', [
        { field: 'name', issue: 'ZONE_NAME_TAKEN' },
      ]);
    default:
      return err;
  }
}

/** §2.1 activation preconditions: name, city, state, at least one pincode, a delivery charge (0 is allowed). */
export function missingForActivation(z: {
  name: string;
  city: string;
  state: string | null;
  pincodeCount: number;
  deliveryChargePaise: number | null;
}): string[] {
  const missing: string[] = [];
  if (!z.name.trim()) missing.push('name');
  if (!z.city.trim()) missing.push('city');
  if (!z.state?.trim()) missing.push('state');
  if (z.pincodeCount < 1) missing.push('pincodes');
  if (z.deliveryChargePaise === null) missing.push('deliveryCharge');
  return missing;
}

const notActivatable = (missing: string[]) =>
  new AppError(
    'ZONE_NOT_ACTIVATABLE',
    `The zone cannot go live yet: ${missing.join(', ')} missing`,
    missing.map((m) => ({ field: m, issue: 'required' })),
    undefined,
    { missing },
  );

export class ZonesService {
  constructor(
    private readonly deps: {
      db: ZonesDatabase;
      impact: ImpactService;
      cache: ZonesCacheVersion;
      clock: () => Date;
      /** D165: settings zones.deliveryChargeCapPaise (absent or unreadable: the ₹1 000 ceiling) */
      deliveryChargeCap?: () => Promise<number>;
    },
  ) {}

  /** D165: 422 ABOVE_ZONE_CAP when a charge is above the Super Admin's cap. */
  private async assertWithinChargeCap(charge: number | undefined): Promise<void> {
    if (charge === undefined) return;
    let cap = MAX_DELIVERY_CHARGE_PAISE;
    try {
      if (this.deps.deliveryChargeCap) cap = await this.deps.deliveryChargeCap();
    } catch {
      cap = MAX_DELIVERY_CHARGE_PAISE;
    }
    if (charge > cap)
      throw new AppError(
        'VALIDATION_ERROR',
        'The delivery charge is above the cap (Settings > Zones)',
        [{ field: 'deliveryChargePaise', issue: 'ABOVE_ZONE_CAP' }],
        undefined,
        { capPaise: cap },
      );
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  async list(ctx: AuthContext, q: ZoneListQuery) {
    const rows = await this.deps.db.repo.list(ctx, q);
    const page = buildCursorPage(rows, q.limit, (z) => z.id);
    const ids = page.data.map((z) => z.id);
    const [figures, services] = await Promise.all([
      this.deps.impact.listFigures(ctx, ids),
      this.deps.db.repo.serviceRows(ctx, ids),
    ]);
    return {
      data: page.data.map((z) => ({
        ...z,
        services: zoneServiceFlags(services.get(z.id) ?? []),
        counts: figures.counts.get(z.id) ?? {
          restaurants: 0,
          homemakers: 0,
          partners: 0,
          customers: 0,
          members: 0,
        },
        team: figures.team(z.id),
      })),
      meta: page.meta,
      partial: figures.missing.length > 0,
      missingSources: figures.missing,
    };
  }

  async summary(ctx: AuthContext) {
    const [byStatus, ids] = await Promise.all([
      this.deps.db.repo.statusCounts(ctx),
      this.deps.db.repo.listIds(ctx),
    ]);
    const noTeam = await this.deps.impact.zonesWithoutTeam(ctx, ids);
    return {
      total: byStatus.UPCOMING + byStatus.ACTIVE + byStatus.INACTIVE,
      active: byStatus.ACTIVE,
      inactive: byStatus.INACTIVE,
      upcoming: byStatus.UPCOMING,
      withoutTeam: noTeam.count,
      partial: noTeam.missing.length > 0,
      missingSources: noTeam.missing,
    };
  }

  async detail(ctx: AuthContext, id: string, q: ZoneDetailQuery) {
    const zone = await this.deps.db.repo.findById(ctx, id);
    if (!zone) throw notFound();
    const window = pageWindow({ page: q.pincodePage, pageSize: q.pincodePageSize });
    const [pincodes, figures, services] = await Promise.all([
      this.deps.db.repo.pincodePage(ctx, id, { ...window, prefix: q.pincodeQ }),
      this.deps.impact.listFigures(ctx, [id]),
      this.deps.db.repo.serviceRows(ctx, [id]),
    ]);
    return {
      ...zone,
      services: zoneServiceFlags(services.get(id) ?? []),
      counts: figures.counts.get(id) ?? {
        restaurants: 0,
        homemakers: 0,
        partners: 0,
        customers: 0,
        members: 0,
      },
      team: figures.team(id),
      pincodes: {
        data: pincodes.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        meta: { page: q.pincodePage, pageSize: q.pincodePageSize, total: pincodes.total },
      },
      partial: figures.missing.length > 0,
      missingSources: figures.missing,
    };
  }

  async lookup(ctx: AuthContext, pincode: string) {
    return { pincode, zone: await this.deps.db.repo.ownerOf(ctx, pincode) };
  }

  async impact(ctx: AuthContext, id: string) {
    if (!(await this.deps.db.repo.findById(ctx, id))) throw notFound();
    return this.deps.impact.impact(ctx, id);
  }

  async team(ctx: AuthContext, id: string) {
    if (!(await this.deps.db.repo.findById(ctx, id))) throw notFound();
    return this.deps.impact.team(ctx, id);
  }

  // ---- writes --------------------------------------------------------------------------------------------------------

  /** One transaction; the cache counter is bumped only after a commit that changed something. */
  // ---- service switches (D92) ------------------------------------------------------------------------------------

  async services(ctx: AuthContext, id: string): Promise<ZoneServicesResponse> {
    if (!(await this.deps.db.repo.findById(ctx, id))) throw notFound();
    const stored = (await this.deps.db.repo.serviceRows(ctx, [id])).get(id) ?? [];
    return {
      zoneId: id,
      services: ZONE_SERVICES.map((service) => {
        const row = stored.find((r) => r.service === service);
        return {
          service,
          label: ZONE_SERVICE_LABELS[service],
          enabled: row?.enabled ?? ZONE_SERVICE_DEFAULTS[service],
          isDefault: row === undefined,
          updatedAt: row?.updatedAt.toISOString() ?? null,
          updatedBy: row?.updater ?? null,
        };
      }),
    };
  }

  /**
   * PUT /zones/{id}/services (D92): switch services on or off. Only real changes are written; one audit row
   * (zone.services_changed, HIGH) and one internal admin.zones_changed event; nothing is told to the apps yet.
   */
  async putServices(
    ctx: AuthContext,
    id: string,
    input: PutZoneServicesInput,
  ): Promise<ZoneServicesResponse> {
    await this.write(async (tx) => {
      const zone = await this.current(tx, ctx, id, null);
      const before = zoneServiceFlags((await tx.repo.serviceRows(ctx, [id])).get(id) ?? []);
      const changes = ZONE_SERVICES.flatMap((service) => {
        const wanted = input.services[service];
        return wanted === undefined || wanted === before[service]
          ? []
          : [{ service, enabled: wanted }];
      });
      if (changes.length === 0) {
        noteAuditNoop();
        return { result: undefined, changed: false };
      }
      await tx.repo.upsertServices(ctx, id, changes);
      const after = { ...before };
      for (const c of changes) after[c.service] = c.enabled;
      await this.audit(tx, 'zone.services_changed', zone, before, after);
      await tx.repo.insertOutbox(ctx, [
        zoneInternalEventRow({
          zoneId: id,
          change: 'services_changed',
          actorId: ctx.userId,
          occurredAt: this.deps.clock(),
        }),
      ]);
      // the resolver cache does not hold services: nothing to bump
      return { result: undefined, changed: false };
    });
    return this.services(ctx, id);
  }

  /**
   * For the order and onboarding modules (D92): refuses with 409 ZONE_SERVICE_DISABLED when the service is off in the
   * zone, 404 when the zone does not exist.
   */
  async assertServiceEnabled(zoneId: string, service: ZoneServiceKind): Promise<void> {
    const sw = await this.deps.db.repo.serviceSwitchForIntake(zoneId, service);
    if (!sw) throw notFound();
    if (!(sw.enabled ?? ZONE_SERVICE_DEFAULTS[service]))
      throw new AppError(
        'ZONE_SERVICE_DISABLED',
        `${ZONE_SERVICE_LABELS[service]} is switched off in this zone`,
        undefined,
        undefined,
        { service },
      );
  }

  private async write<T>(
    fn: (tx: ZonesTx) => Promise<{ result: T; changed: boolean }>,
  ): Promise<T> {
    let out: { result: T; changed: boolean };
    try {
      out = await this.deps.db.transaction(fn);
    } catch (err) {
      throw fromUniqueViolation(err);
    }
    if (out.changed) {
      try {
        await this.deps.cache.bump();
      } catch (err) {
        // committed already; resolver answers are at most one TTL (300 s) old. Class name only (doc 13).
        console.error(`zones:version bump failed ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    return out.result;
  }

  private async emit(
    tx: ZonesTx,
    ctx: AuthContext,
    zone: ZoneDto,
    change: ZoneChange,
  ): Promise<void> {
    const onlyRangeRows = await tx.repo.onlyRangePincodes(ctx, zone.id);
    await tx.repo.insertOutbox(
      ctx,
      zoneEventRows({
        zone,
        change,
        actorId: ctx.userId,
        occurredAt: this.deps.clock(),
        onlyRangeRows,
      }),
    );
  }

  private audit(
    tx: ZonesTx,
    action: AuditActionKey,
    zone: ZoneDto,
    before: unknown,
    after: unknown,
    note?: string,
  ): Promise<void> {
    return record(tx.audit, {
      module: 'zones',
      action,
      entity: { type: 'zone', id: zone.id, label: zone.name, zoneId: zone.id },
      before,
      after,
      ...(note ? { note } : {}),
    });
  }

  /** Read inside the transaction: 404 for a missing zone, STALE_VERSION (with the newer values) for an old version. */
  private async current(tx: ZonesTx, ctx: AuthContext, id: string, version: number | null) {
    const zone = await tx.repo.findLive(ctx, id);
    if (!zone) throw notFound();
    if (version !== null && zone.version !== version) throw stale(zone);
    return zone;
  }

  private async update(
    tx: ZonesTx,
    ctx: AuthContext,
    id: string,
    version: number | null,
    changes: ZoneChanges,
  ): Promise<ZoneDto> {
    const updated = await tx.repo.updateZone(ctx, id, version, changes);
    if (updated) return updated;
    // moved between our read and the update
    const now = await tx.repo.findLive(ctx, id);
    throw now ? stale(now) : notFound();
  }

  async create(ctx: AuthContext, input: CreateZoneInput): Promise<ZoneDto> {
    await this.assertWithinChargeCap(input.deliveryChargePaise);
    const rows = initialPincodes(input);
    if (input.status === 'ACTIVE') {
      const missing = missingForActivation({
        ...input,
        state: input.state,
        pincodeCount: rows.length,
        deliveryChargePaise: input.deliveryChargePaise,
      });
      if (missing.length > 0) throw notActivatable(missing);
    }
    const now = this.deps.clock();
    return this.write(async (tx) => {
      await tx.repo.lockPincodes(ctx);
      if (await tx.repo.nameTaken(ctx, input.name))
        throw new AppError('ZONE_NAME_TAKEN', 'Another zone already has this name', [
          { field: 'name', issue: 'ZONE_NAME_TAKEN' },
        ]);
      if (await tx.repo.codeTaken(ctx, input.code))
        throw new AppError(
          'ZONE_CODE_TAKEN',
          'This code is already used by another zone (codes are never reused)',
          [{ field: 'code', issue: 'ZONE_CODE_TAKEN' }],
        );
      await assertNoOverlap(
        tx.repo,
        ctx,
        rows.map((r) => r.pincode),
      );
      const id = uuidv7();
      await tx.repo.insertZone(ctx, {
        id,
        name: input.name,
        code: input.code,
        city: input.city,
        state: input.state,
        pincodeFrom: input.pincodeFrom ?? null,
        pincodeTo: input.pincodeTo ?? null,
        deliveryCharge: input.deliveryChargePaise,
        status: input.status,
        colorHex: input.colorHex,
        description: input.description ?? null,
        activatedAt: input.status === 'ACTIVE' ? now : null,
      });
      await tx.repo.insertPincodes(
        ctx,
        id,
        rows.map((r) => ({ id: uuidv7(), ...r })),
      );
      const zone = await tx.repo.findLive(ctx, id);
      if (!zone) throw notFound();
      await this.audit(tx, 'zone.created', zone, undefined, auditView(zone));
      await this.emit(tx, ctx, zone, 'created');
      return { result: zone, changed: true };
    });
  }

  async patch(ctx: AuthContext, id: string, input: PatchZoneInput): Promise<ZoneDto> {
    return this.write(async (tx) => {
      const before = await this.current(tx, ctx, id, input.version);
      const changes: ZoneChanges = {};
      if (input.name !== undefined && input.name !== before.name) changes.name = input.name;
      if (input.city !== undefined && input.city !== before.city) changes.city = input.city;
      if (input.state !== undefined && input.state !== before.state) changes.state = input.state;
      if (input.colorHex !== undefined && input.colorHex !== before.colorHex)
        changes.colorHex = input.colorHex;
      if (input.description !== undefined && input.description !== before.description)
        changes.description = input.description;
      const chargeChanged =
        input.deliveryChargePaise !== undefined &&
        input.deliveryChargePaise !== before.deliveryChargePaise;
      if (chargeChanged) {
        await this.assertWithinChargeCap(input.deliveryChargePaise);
        changes.deliveryCharge = input.deliveryChargePaise;
      }

      if (Object.keys(changes).length === 0) {
        // nothing changed: nothing recorded (audit no-op), no event, no version bump
        await this.audit(tx, 'zone.updated', before, auditView(before), auditView(before));
        return { result: before, changed: false };
      }
      if (
        changes.name !== undefined &&
        changes.name.toLowerCase() !== before.name.toLowerCase() &&
        (await tx.repo.nameTaken(ctx, changes.name, id))
      )
        throw new AppError('ZONE_NAME_TAKEN', 'Another zone already has this name', [
          { field: 'name', issue: 'ZONE_NAME_TAKEN' },
        ]);

      const after = await this.update(tx, ctx, id, input.version, changes);
      const { deliveryChargePaise: chargeBefore, ...restBefore } = auditView(before);
      const { deliveryChargePaise: chargeAfter, ...restAfter } = auditView(after);
      // charge changes have their own action (doc 53 section 4); zone.updated covers the rest
      await this.audit(tx, 'zone.updated', after, restBefore, restAfter);
      if (chargeChanged)
        await this.audit(
          tx,
          'zone.delivery_charge_changed',
          after,
          { deliveryChargePaise: chargeBefore },
          { deliveryChargePaise: chargeAfter },
        );
      const onlyCharge = chargeChanged && Object.keys(changes).length === 1;
      await this.emit(tx, ctx, after, onlyCharge ? 'delivery_charge_changed' : 'updated');
      return { result: after, changed: true };
    });
  }

  async pincodes(ctx: AuthContext, id: string, input: ZonePincodesInput, preview: boolean) {
    return this.write(async (tx) => {
      await tx.repo.lockPincodes(ctx);
      const zone = await this.current(tx, ctx, id, null);
      const plan = planPincodeChange(await tx.repo.zonePincodes(ctx, id), input);
      const conflicts = await tx.repo.findOwners(
        ctx,
        plan.add.map((r) => r.pincode),
        id,
      );
      const { mismatches, missing } = await this.deps.impact.mismatches(ctx, id, plan.remove);
      const rangeChanged =
        input.range !== undefined &&
        (input.range.from !== zone.pincodeFrom || input.range.to !== zone.pincodeTo);
      const result = (z: ZoneDto) => ({
        preview,
        added: plan.add.map((r) => r.pincode),
        removed: plan.remove,
        conflicts: preview ? conflicts : [],
        mismatches,
        zone: z,
        partial: missing.length > 0,
        missingSources: missing,
      });
      const noop = () => this.audit(tx, 'zone.pincodes_changed', zone, {}, {});

      if (preview) {
        await noop(); // a dry run writes nothing (audit no-op)
        return { result: result(zone), changed: false };
      }
      if (conflicts.length > 0)
        await assertNoOverlap(
          tx.repo,
          ctx,
          plan.add.map((r) => r.pincode),
          id,
        );
      if (plan.add.length === 0 && plan.remove.length === 0 && !rangeChanged) {
        await noop();
        return { result: result(zone), changed: false };
      }

      await tx.repo.deletePincodes(ctx, id, plan.remove);
      await tx.repo.insertPincodes(
        ctx,
        id,
        plan.add.map((r) => ({ id: uuidv7(), ...r })),
      );
      const after = await this.update(
        tx,
        ctx,
        id,
        null,
        input.range ? { pincodeFrom: input.range.from, pincodeTo: input.range.to } : {},
      );
      await this.audit(
        tx,
        'zone.pincodes_changed',
        after,
        {
          pincodeFrom: zone.pincodeFrom,
          pincodeTo: zone.pincodeTo,
          pincodeCount: zone.pincodeCount,
        },
        {
          pincodeFrom: after.pincodeFrom,
          pincodeTo: after.pincodeTo,
          pincodeCount: after.pincodeCount,
          added: plan.add.length,
          removed: plan.remove.length,
          // doc 53 section 4: the removed list, capped at 200
          removedPincodes: plan.remove.slice(0, 200),
        },
      );
      await this.emit(tx, ctx, after, 'pincodes_changed');
      return { result: result(after), changed: true };
    });
  }

  async activate(ctx: AuthContext, id: string, version: number): Promise<ZoneDto> {
    return this.write(async (tx) => {
      const before = await this.current(tx, ctx, id, version);
      // UPCOMING -> ACTIVE and INACTIVE -> ACTIVE only (§2.1)
      if (before.status === 'ACTIVE')
        throw new AppError('INVALID_STATE_TRANSITION', 'The zone is already active');
      const missing = missingForActivation(before);
      if (missing.length > 0) throw notActivatable(missing);
      const after = await this.update(tx, ctx, id, version, {
        status: 'ACTIVE',
        activatedAt: this.deps.clock(),
      });
      await this.audit(
        tx,
        'zone.activated',
        after,
        { status: before.status },
        { status: after.status },
      );
      await this.emit(tx, ctx, after, 'activated');
      return { result: after, changed: true };
    });
  }

  /**
   * ACTIVE -> INACTIVE or UPCOMING -> INACTIVE (§2.1). The impact the dialog showed must still be the impact now. Only
   * the zone row changes: open orders, vendors and partners are untouched (R-ZONE-6), so reactivation needs no repair.
   */
  async deactivate(ctx: AuthContext, id: string, input: DeactivateZoneInput): Promise<ZoneDto> {
    if (!(await this.deps.db.repo.findById(ctx, id))) throw notFound();
    const impact = await this.deps.impact.impact(ctx, id);
    if (impact.impactVersion !== input.impactVersion)
      throw new AppError(
        'IMPACT_CHANGED',
        'The numbers changed since the dialog opened. Review them and confirm again',
        [{ field: 'impactVersion', issue: 'IMPACT_CHANGED' }],
        undefined,
        { impact },
      );
    return this.write(async (tx) => {
      const before = await this.current(tx, ctx, id, input.version);
      if (before.status === 'INACTIVE')
        throw new AppError('INVALID_STATE_TRANSITION', 'The zone is already inactive');
      const after = await this.update(tx, ctx, id, input.version, {
        status: 'INACTIVE',
        deactivatedAt: this.deps.clock(),
        deactivationReason: input.reason,
      });
      await this.audit(
        tx,
        'zone.deactivated',
        after,
        { status: before.status },
        { status: after.status, deactivationReason: input.reason },
        input.reason,
      );
      await this.emit(tx, ctx, after, 'deactivated');
      return { result: after, changed: true };
    });
  }

  /**
   * Only a pristine zone (never had vendors, partners, customer addresses, orders or members) that is not live. Soft
   * delete: the code stays reserved (R-ZONE-3). Its pincodes are released (deleted), as an explicit removal would.
   */
  async remove(ctx: AuthContext, id: string): Promise<void> {
    await this.write(async (tx) => {
      await tx.repo.lockPincodes(ctx);
      const before = await this.current(tx, ctx, id, null);
      if (before.status === 'ACTIVE')
        throw new AppError('INVALID_STATE_TRANSITION', 'Deactivate the zone before deleting it');
      const counts = await tx.repo.historyCounts(ctx, id);
      if (Object.values(counts).some((n) => n > 0))
        throw new AppError(
          'ZONE_HAS_HISTORY',
          'This zone has history and cannot be deleted. Deactivate it instead',
          undefined,
          undefined,
          { counts },
        );
      const pincodes = (await tx.repo.zonePincodes(ctx, id)).map((p) => p.pincode);
      await tx.repo.deletePincodes(ctx, id, pincodes);
      const now = this.deps.clock();
      const after = await this.update(tx, ctx, id, null, { deletedAt: now });
      await this.audit(tx, 'zone.deleted', after, auditView(before), {
        deletedAt: now,
        pincodesReleased: pincodes.length,
      });
      await this.emit(tx, ctx, after, 'deleted');
      return { result: undefined, changed: true };
    });
  }
}
