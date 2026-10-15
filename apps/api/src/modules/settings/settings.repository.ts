import { Prisma, type PrismaClient } from '@prisma/client';
import type { SettingHistoryQuery } from '@zoauro/shared';
import { cursorFetchSize } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import { AppError } from '../../lib/errors';

// Platform settings and zone overrides (doc 59 §4: settings, zone_settings), and the settings history read from the
// append-only audit log. The only file of the settings module that imports Prisma. settings:* is never grantable, so
// every admin method refuses anyone but a Super Admin; the reader methods at the bottom serve other modules.

export interface StoredSetting {
  key: string;
  value: unknown;
  version: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
}

const updater = { select: { id: true, name: true } } as const;

export class SettingsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  private superAdminOnly(ctx: AuthContext): void {
    if (!ctx.isSuperAdmin) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
  }

  async platform(ctx: AuthContext, keys: readonly string[]): Promise<Map<string, StoredSetting>> {
    this.superAdminOnly(ctx);
    return this.platformValues(keys);
  }

  async zone(
    ctx: AuthContext,
    zoneId: string,
    keys: readonly string[],
  ): Promise<Map<string, StoredSetting>> {
    this.superAdminOnly(ctx);
    const rows = await this.db.zoneSetting.findMany({
      where: { zoneId, key: { in: [...keys] } },
      select: { key: true, valueJson: true, version: true, updatedAt: true, updater },
    });
    return new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          value: r.valueJson,
          version: r.version,
          updatedAt: r.updatedAt,
          updatedBy: r.updater,
        },
      ]),
    );
  }

  async findZone(
    ctx: AuthContext,
    id: string,
  ): Promise<{ id: string; name: string; code: string } | null> {
    this.superAdminOnly(ctx);
    return this.db.zone.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
  }

  async liveZones(ctx: AuthContext): Promise<{ id: string; name: string; code: string }[]> {
    this.superAdminOnly(ctx);
    return this.db.zone.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Serialises writes of one key (platform and zone rows alike) for the rest of the transaction. */
  async lockKey(ctx: AuthContext, key: string): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settings:${key}`}))`;
  }

  async upsertPlatform(
    ctx: AuthContext,
    s: { key: string; group: string; value: unknown; nextVersion: number },
  ): Promise<void> {
    this.superAdminOnly(ctx);
    const value = s.value as Prisma.InputJsonValue;
    await this.db.setting.upsert({
      where: { key: s.key },
      create: {
        key: s.key,
        group: s.group,
        valueJson: value,
        version: s.nextVersion,
        updatedBy: ctx.userId,
      },
      update: { valueJson: value, version: s.nextVersion, updatedBy: ctx.userId },
    });
  }

  async deletePlatform(ctx: AuthContext, key: string): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.setting.deleteMany({ where: { key } });
  }

  async upsertZone(
    ctx: AuthContext,
    s: { zoneId: string; key: string; value: unknown; nextVersion: number },
  ): Promise<void> {
    this.superAdminOnly(ctx);
    const value = s.value as Prisma.InputJsonValue;
    await this.db.zoneSetting.upsert({
      where: { zoneId_key: { zoneId: s.zoneId, key: s.key } },
      create: {
        zoneId: s.zoneId,
        key: s.key,
        valueJson: value,
        version: s.nextVersion,
        updatedBy: ctx.userId,
      },
      update: { valueJson: value, version: s.nextVersion, updatedBy: ctx.userId },
    });
  }

  async deleteZone(ctx: AuthContext, zoneId: string, key: string): Promise<void> {
    this.superAdminOnly(ctx);
    await this.db.zoneSetting.deleteMany({ where: { zoneId, key } });
  }

  /** Active assignments with what their own limits resolve to (assignment ?? profile default ?? 0), for the cap preview. */
  async activeLimits(
    ctx: AuthContext,
    zoneIds: readonly string[] | 'ALL',
  ): Promise<
    {
      memberId: string;
      name: string;
      zoneId: string;
      zoneName: string;
      perRefundPaise: number;
      dailyRefundPaise: number;
    }[]
  > {
    this.superAdminOnly(ctx);
    const rows = await this.db.adminZoneAssignment.findMany({
      where: {
        revokedAt: null,
        user: { deletedAt: null },
        zone: { deletedAt: null },
        ...(zoneIds === 'ALL' ? {} : { zoneId: { in: [...zoneIds] } }),
      },
      select: {
        perRefundLimit: true,
        dailyRefundLimit: true,
        user: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
        profile: { select: { defaultPerRefundLimit: true, defaultDailyRefundLimit: true } },
      },
      orderBy: [{ zone: { name: 'asc' } }, { user: { name: 'asc' } }],
    });
    return rows.map((r) => ({
      memberId: r.user.id,
      name: r.user.name,
      zoneId: r.zone.id,
      zoneName: r.zone.name,
      perRefundPaise: r.perRefundLimit ?? r.profile.defaultPerRefundLimit ?? 0,
      dailyRefundPaise: r.dailyRefundLimit ?? r.profile.defaultDailyRefundLimit ?? 0,
    }));
  }

  /** Settings History (doc 59 §5): the audit rows of module `settings`, newest first. */
  async history(ctx: AuthContext, q: SettingHistoryQuery) {
    this.superAdminOnly(ctx);
    const where: Prisma.AuditLogWhereInput = {
      module: 'settings',
      ...(q.key
        ? { entityLabel: q.key }
        : q.group
          ? { entityLabel: { startsWith: `${q.group}.` } }
          : {}),
      ...(q.zoneId ? { zoneId: q.zoneId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(q.after ? { id: { lt: q.after } } : {}),
    };
    const rows = await this.db.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: cursorFetchSize(q.limit),
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityLabel: true,
        actorId: true,
        actorName: true,
        zoneId: true,
        beforeJson: true,
        afterJson: true,
        note: true,
      },
    });
    const zoneIds = [...new Set(rows.map((r) => r.zoneId).filter((z): z is string => z !== null))];
    const zones = await this.db.zone.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, name: true },
    });
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    return rows.map((r) => ({
      ...r,
      zoneName: r.zoneId ? (zoneName.get(r.zoneId) ?? null) : null,
    }));
  }

  // ---- readers for other modules (no admin context: the values are not personal data) ------------------------------

  async platformValues(keys: readonly string[]): Promise<Map<string, StoredSetting>> {
    const rows = await this.db.setting.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, valueJson: true, version: true, updatedAt: true, updater },
    });
    return new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          value: r.valueJson,
          version: r.version,
          updatedAt: r.updatedAt,
          updatedBy: r.updater,
        },
      ]),
    );
  }

  async zoneValues(key: string, zoneIds: readonly string[]): Promise<Map<string, unknown>> {
    if (zoneIds.length === 0) return new Map();
    const rows = await this.db.zoneSetting.findMany({
      where: { key, zoneId: { in: [...zoneIds] } },
      select: { zoneId: true, valueJson: true },
    });
    return new Map(rows.map((r) => [r.zoneId, r.valueJson]));
  }
}

export interface SettingsTx {
  repo: SettingsRepository;
  audit: AuditTx;
}

export class SettingsDatabase {
  readonly repo: SettingsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new SettingsRepository(prisma);
  }

  transaction<T>(fn: (tx: SettingsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new SettingsRepository(tx), audit: auditTx(tx) }),
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }
}
