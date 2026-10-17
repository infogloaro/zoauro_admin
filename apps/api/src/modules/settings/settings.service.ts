import {
  AUDIT_ACTIONS,
  buildCursorPage,
  deliveryMaxConcurrentOrdersSchema,
  effectiveSetting,
  refundLimitsSchema,
  renderOrderNumber,
  settingDef,
  settingsOfGroup,
  SETTINGS,
  type AuditActionKey,
  type PreviewSettingsInput,
  type PutSettingsInput,
  type SettingDef,
  type SettingGroup,
  type SettingHistoryQuery,
  type SettingListResponse,
  type SettingsPreview,
  type SettingView,
} from '@zoauro/shared';
import type { z } from 'zod';
import { noteAuditNoop, record } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { SettingsDatabase, SettingsTx, StoredSetting } from './settings.repository';

// Platform settings (doc 59 §2–5, owner decisions D109–D116): effective = zone override ?? platform value ?? code
// default. A write is one transaction with its audit row per key (the reason is the note); "Reset to default" deletes
// the saved value. Settings History is the audit trail of module `settings`.

const notFound = () => new AppError('NOT_FOUND', 'Not found');

/** JSON with object keys sorted: jsonb reorders keys, so two equal values must compare equal whatever their order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : val,
  );
}
type RefundCaps = z.infer<typeof refundLimitsSchema>;

export interface SettingsDeps {
  db: SettingsDatabase;
  clock: () => Date;
  /** whether an SMS provider is ready (server environment), for notifications.channels.sms (D99) */
  smsReady: () => boolean;
  /** cleared after every write (the in-process reader cache) */
  onChanged: () => void;
}

const view = (
  def: SettingDef,
  platform: StoredSetting | undefined,
  zone: StoredSetting | undefined,
): SettingView => {
  const eff = effectiveSetting(
    def,
    platform ? { value: platform.value } : null,
    zone ? { value: zone.value } : null,
  );
  const stored = (s: StoredSetting | undefined) =>
    s
      ? {
          value: s.value,
          version: s.version,
          updatedAt: s.updatedAt.toISOString(),
          updatedBy: s.updatedBy,
        }
      : null;
  return {
    key: def.key,
    group: def.group,
    label: def.label,
    description: def.description,
    zoneOverride: def.zoneOverride,
    reauth: def.reauth,
    editable: def.editable,
    default: def.default,
    platform: stored(platform),
    zone: stored(zone),
    effective: eff.value,
    source: eff.source,
    effect:
      eff.value === null
        ? { state: 'NOT_CONFIGURED', module: null }
        : def.effect.state === 'ENFORCED'
          ? { state: 'ENFORCED', module: null }
          : { state: 'PENDING_MODULE', module: def.effect.module },
  };
};

export class SettingsService {
  constructor(private readonly deps: SettingsDeps) {}

  // ---- reads ------------------------------------------------------------------------------------------------------

  async list(
    ctx: AuthContext,
    group?: SettingGroup,
    zoneId?: string,
  ): Promise<SettingListResponse> {
    const defs = group ? settingsOfGroup(group) : [...SETTINGS];
    const keys = defs.map((d) => d.key);
    if (zoneId && !(await this.deps.db.repo.findZone(ctx, zoneId))) throw notFound();
    const [platform, zone] = await Promise.all([
      this.deps.db.repo.platform(ctx, keys),
      zoneId
        ? this.deps.db.repo.zone(ctx, zoneId, keys)
        : Promise.resolve(new Map<string, StoredSetting>()),
    ]);
    return {
      zoneId: zoneId ?? null,
      data: defs.map((d) => view(d, platform.get(d.key), zoneId ? zone.get(d.key) : undefined)),
    };
  }

  // ---- validation -------------------------------------------------------------------------------------------------

  /** Every key must belong to the group, be editable (and zone-overridable for a zone) and pass its schema. */
  private validate(
    group: SettingGroup,
    values: Record<string, unknown>,
    zoneId: string | null,
    mode: 'write' | 'preview' = 'write',
  ) {
    const out: { def: SettingDef; value: unknown }[] = [];
    const details: { field: string; issue: string }[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const def = settingDef(key);
      if (!def || def.group !== group) {
        details.push({ field: `values.${key}`, issue: 'UNKNOWN_SETTING' });
        continue;
      }
      if (!def.editable) {
        details.push({ field: `values.${key}`, issue: 'NOT_EDITABLE_HERE' });
        continue;
      }
      // a preview may name a zone only for context (e.g. the zone code in an order number example)
      if (zoneId && !def.zoneOverride && mode === 'write') {
        details.push({ field: `values.${key}`, issue: 'NO_ZONE_OVERRIDE' });
        continue;
      }
      const parsed = def.schema.safeParse(raw);
      if (!parsed.success) {
        for (const i of parsed.error.issues)
          details.push({
            field: ['values', key, ...i.path.map(String)].join('.'),
            issue: i.code === 'custom' ? i.message : i.code,
          });
        continue;
      }
      if (
        key === 'notifications.channels' &&
        (parsed.data as { sms: boolean }).sms &&
        !this.deps.smsReady()
      )
        details.push({ field: 'values.notifications.channels.sms', issue: 'SMS_NOT_AVAILABLE' });
      out.push({ def, value: parsed.data });
    }
    if (details.length > 0)
      throw new AppError('VALIDATION_ERROR', 'Invalid setting values', details);
    return out;
  }

  // ---- writes -----------------------------------------------------------------------------------------------------

  private async write<T>(fn: (tx: SettingsTx) => Promise<T>): Promise<T> {
    const result = await this.deps.db.transaction(fn);
    this.deps.onChanged();
    return result;
  }

  private stale(key: string, current: StoredSetting | undefined) {
    return new AppError(
      'STALE_VERSION',
      'This setting was changed by someone else. Review the newer value and try again',
      [{ field: `versions.${key}`, issue: 'stale' }],
      undefined,
      { current: { key, value: current?.value ?? null, version: current?.version ?? 0 } },
    );
  }

  /** PUT /settings/{group} (zoneId null) and PUT /zones/{id}/settings/{group}. */
  async put(
    ctx: AuthContext,
    group: SettingGroup,
    input: PutSettingsInput,
    zoneId: string | null,
  ): Promise<SettingListResponse> {
    const items = this.validate(group, input.values, zoneId);
    if (zoneId && !(await this.deps.db.repo.findZone(ctx, zoneId))) throw notFound();
    await this.write(async (tx) => {
      let changed = 0;
      for (const { def, value } of items) {
        await tx.repo.lockKey(ctx, def.key);
        const current = (
          zoneId
            ? await tx.repo.zone(ctx, zoneId, [def.key])
            : await tx.repo.platform(ctx, [def.key])
        ).get(def.key);
        const expected = input.versions?.[def.key];
        if (expected !== undefined && expected !== (current?.version ?? 0))
          throw this.stale(def.key, current);
        if (current && canonical(current.value) === canonical(value)) continue;
        const nextVersion = (current?.version ?? 0) + 1;
        if (zoneId) await tx.repo.upsertZone(ctx, { zoneId, key: def.key, value, nextVersion });
        else
          await tx.repo.upsertPlatform(ctx, { key: def.key, group: def.group, value, nextVersion });
        await this.audit(
          tx,
          zoneId ? 'settings.zone_override_set' : 'settings.updated',
          def.key,
          zoneId,
          {
            before: current?.value ?? (zoneId ? null : def.default),
            after: value,
            reason: input.reason,
          },
        );
        changed += 1;
      }
      if (changed === 0) noteAuditNoop();
    });
    return this.list(ctx, group, zoneId ?? undefined);
  }

  /** DELETE /settings/{group}/{key} (back to the default rule) and DELETE /zones/{id}/settings/{group}/{key}. */
  async reset(
    ctx: AuthContext,
    group: SettingGroup,
    key: string,
    reason: string,
    zoneId: string | null,
  ): Promise<SettingListResponse> {
    const def = settingDef(key);
    if (!def || def.group !== group || !def.editable || (zoneId && !def.zoneOverride))
      throw notFound();
    if (zoneId && !(await this.deps.db.repo.findZone(ctx, zoneId))) throw notFound();
    await this.write(async (tx) => {
      await tx.repo.lockKey(ctx, key);
      const current = (
        zoneId ? await tx.repo.zone(ctx, zoneId, [key]) : await tx.repo.platform(ctx, [key])
      ).get(key);
      if (!current) {
        noteAuditNoop(); // nothing saved: the default (or the platform value) already applies
        return;
      }
      if (zoneId) await tx.repo.deleteZone(ctx, zoneId, key);
      else await tx.repo.deletePlatform(ctx, key);
      await this.audit(
        tx,
        zoneId ? 'settings.zone_override_removed' : 'settings.reset',
        key,
        zoneId,
        {
          before: current.value,
          after: zoneId ? null : def.default,
          reason,
        },
      );
    });
    return this.list(ctx, group, zoneId ?? undefined);
  }

  private audit(
    tx: SettingsTx,
    action: AuditActionKey,
    key: string,
    zoneId: string | null,
    v: { before: unknown; after: unknown; reason: string },
  ): Promise<void> {
    return record(tx.audit, {
      module: 'settings',
      action,
      entity: { type: 'setting', label: key, ...(zoneId ? { zoneId } : {}) },
      before: v.before,
      after: v.after,
      note: v.reason,
    });
  }

  // ---- preview ------------------------------------------------------------------------------------------------------

  /** POST /settings/{group}/preview: validate and diff without saving; who a new refund cap would clamp (D110). */
  async preview(
    ctx: AuthContext,
    group: SettingGroup,
    input: PreviewSettingsInput,
  ): Promise<SettingsPreview> {
    const zoneId = input.zoneId ?? null;
    const items = this.validate(group, input.values, zoneId, 'preview');
    const current = await this.list(ctx, group, zoneId ?? undefined);
    const changes = items.map(({ def, value }) => ({
      key: def.key,
      before: current.data.find((s) => s.key === def.key)?.effective ?? null,
      after: value,
    }));

    let membersAboveCap: SettingsPreview['membersAboveCap'] = [];
    const caps = items.find((i) => i.def.key === 'refunds.limits')?.value as RefundCaps | undefined;
    if (caps) {
      // a platform change reaches every zone without its own value; a zone change reaches that zone
      let zones: readonly string[] | 'ALL' = zoneId ? [zoneId] : 'ALL';
      if (!zoneId) {
        const all = await this.deps.db.repo.liveZones(ctx);
        const overridden = await this.deps.db.repo.zoneValues(
          'refunds.limits',
          all.map((z) => z.id),
        );
        zones = all.filter((z) => !overridden.has(z.id)).map((z) => z.id);
      }
      const limits = await this.deps.db.repo.activeLimits(ctx, zones);
      membersAboveCap = limits.filter(
        (l) => l.perRefundPaise > caps.perRefundPaise || l.dailyRefundPaise > caps.perDayPaise,
      );
    }

    const format = items.find((i) => i.def.key === 'orders.numberFormat')?.value as
      { template: string } | undefined;
    let orderNumberExample: string | null = null;
    if (format) {
      const zone = zoneId ? await this.deps.db.repo.findZone(ctx, zoneId) : null;
      orderNumberExample = renderOrderNumber(
        format.template,
        zone?.code ?? 'CHN',
        1,
        this.deps.clock(),
      );
    }
    return { zoneId, changes, membersAboveCap, orderNumberExample };
  }

  // ---- history ----------------------------------------------------------------------------------------------------

  async history(ctx: AuthContext, q: SettingHistoryQuery) {
    const rows = await this.deps.db.repo.history(ctx, q);
    const page = buildCursorPage(rows, q.limit, (r) => r.id);
    return {
      data: page.data.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        actionLabel: AUDIT_ACTIONS[r.action as AuditActionKey]?.label ?? r.action,
        key: r.entityLabel,
        actor: { id: r.actorId, name: r.actorName },
        zone: r.zoneId ? { id: r.zoneId, name: r.zoneName } : null,
        before: r.beforeJson,
        after: r.afterJson,
        reason: r.note,
      })),
      meta: page.meta,
    };
  }
}

// ---- reader for other modules ------------------------------------------------------------------------------------------

/** How long a value read by other modules may be stale in another process (doc 14 section 4 allows 60 s). */
const READER_TTL_MS = 30_000;

/**
 * Effective values for other modules, cached in process for 30 s and cleared by every write of this process.
 * refundCaps (D110): the zone caps the access context clamps every Zonal Admin's limits to.
 */
export class SettingsReader {
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly deps: {
      repo: Pick<
        import('./settings.repository').SettingsRepository,
        'platformValues' | 'zoneValues'
      >;
      now: () => number;
    },
  ) {}

  clear(): void {
    this.cache.clear();
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.deps.now() - hit.at < READER_TTL_MS) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: this.deps.now(), value });
    return value;
  }

  async refundCaps(zoneIds: readonly string[]): Promise<Map<string, RefundCaps>> {
    const def = settingDef('refunds.limits');
    if (!def) throw new Error('refunds.limits is not registered');
    const platform = await this.cached('platform:refunds.limits', async () => {
      const row = (await this.deps.repo.platformValues(['refunds.limits'])).get('refunds.limits');
      const parsed = refundLimitsSchema.safeParse(row?.value);
      return parsed.success ? parsed.data : (def.default as RefundCaps);
    });
    const sorted = [...zoneIds].sort();
    const zones = await this.cached(`zones:refunds.limits:${sorted.join(',')}`, () =>
      this.deps.repo.zoneValues('refunds.limits', sorted),
    );
    const out = new Map<string, RefundCaps>();
    for (const z of zoneIds) {
      const own = refundLimitsSchema.safeParse(zones.get(z));
      out.set(z, own.success ? own.data : platform);
    }
    return out;
  }

  /** D121: orders one delivery partner may carry at once in a zone (zone value ?? platform ?? default 1). */
  async maxConcurrentOrders(zoneId: string): Promise<number> {
    const key = 'delivery.maxConcurrentOrders';
    const def = settingDef(key);
    if (!def) throw new Error(`${key} is not registered`);
    const platform = await this.cached(`platform:${key}`, async () => {
      const row = (await this.deps.repo.platformValues([key])).get(key);
      const parsed = deliveryMaxConcurrentOrdersSchema.safeParse(row?.value);
      return parsed.success
        ? parsed.data.perPartner
        : (def.default as { perPartner: number }).perPartner;
    });
    const zones = await this.cached(`zones:${key}:${zoneId}`, () =>
      this.deps.repo.zoneValues(key, [zoneId]),
    );
    const own = deliveryMaxConcurrentOrdersSchema.safeParse(zones.get(zoneId));
    return own.success ? own.data.perPartner : platform;
  }
}
