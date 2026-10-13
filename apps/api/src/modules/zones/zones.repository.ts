import { Prisma, type PrismaClient } from '@prisma/client';
import type { PincodeConflict, PincodeSource, ZoneDto, ZoneListQuery } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import { AppError } from '../../lib/errors';

// The only file of the zones module that imports Prisma (doc 53 section 7). Zones are Super Admin data: `zones:*` is
// never grantable (R-ZONE-1), so reads are bounded by zonesFor(ctx, 'zones:view') (a Zonal Admin's scope is always
// empty and no query runs) and writes refuse anyone but a Super Admin, whatever the route did before.

const zoneSelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  state: true,
  pincodeFrom: true,
  pincodeTo: true,
  deliveryCharge: true,
  status: true,
  colorHex: true,
  description: true,
  version: true,
  activatedAt: true,
  deactivatedAt: true,
  deactivationReason: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { pincodes: true } },
} as const;
type ZoneRow = Prisma.ZoneGetPayload<{ select: typeof zoneSelect }>;

const toDto = (z: ZoneRow): ZoneDto => ({
  id: z.id,
  name: z.name,
  code: z.code,
  city: z.city,
  state: z.state,
  pincodeFrom: z.pincodeFrom,
  pincodeTo: z.pincodeTo,
  pincodeCount: z._count.pincodes,
  deliveryChargePaise: z.deliveryCharge,
  status: z.status,
  colorHex: z.colorHex,
  description: z.description,
  version: z.version,
  activatedAt: z.activatedAt?.toISOString() ?? null,
  deactivatedAt: z.deactivatedAt?.toISOString() ?? null,
  deactivationReason: z.deactivationReason,
  createdAt: z.createdAt.toISOString(),
  updatedAt: z.updatedAt.toISOString(),
});

/** `%`, `_` and `\` are literal in the search text (Prisma passes them through to LIKE). */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Unique violation on one of our constraints (P2002), however the driver adapter reports the target. */
export function uniqueViolationOn(err: unknown): string | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const meta = JSON.stringify(err.meta ?? {});
  for (const name of [
    'serviceable_pincodes_pincode_key',
    'zones_code_key',
    'zones_name_lower_active_key',
  ])
    if (meta.includes(name)) return name;
  if (meta.includes('pincode')) return 'serviceable_pincodes_pincode_key';
  if (meta.includes('code')) return 'zones_code_key';
  return 'unknown';
}

export interface NewZone {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  pincodeFrom: string | null;
  pincodeTo: string | null;
  deliveryCharge: number;
  status: ZoneDto['status'];
  colorHex: string;
  description: string | null;
  activatedAt: Date | null;
}

export type ZoneChanges = Partial<{
  name: string;
  city: string;
  state: string;
  description: string | null;
  colorHex: string;
  deliveryCharge: number;
  pincodeFrom: string | null;
  pincodeTo: string | null;
  status: ZoneDto['status'];
  activatedAt: Date;
  deactivatedAt: Date;
  deactivationReason: string;
  deletedAt: Date;
}>;

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string;
  payload: Record<string, unknown>;
}

/** Records that make a zone "not pristine" (doc 53 section 2.2 item 6). Soft-deleted and revoked rows count too. */
export interface ZoneHistoryCounts {
  restaurants: number;
  homemakers: number;
  partners: number;
  customerAddresses: number;
  orders: number;
  memberAssignments: number;
}

export class ZonesRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** Read filter for this actor; null = sees no zone at all (Zonal Admin), so no query runs. */
  private visible(ctx: AuthContext): Prisma.ZoneWhereInput | null {
    const scope = zonesFor(ctx, 'zones:view');
    if (scope.kind === 'ALL') return { deletedAt: null };
    if (scope.zoneIds.length === 0) return null;
    return { deletedAt: null, id: { in: [...scope.zoneIds] } };
  }

  private writable(ctx: AuthContext): void {
    if (!ctx.isSuperAdmin) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
  }

  async list(ctx: AuthContext, q: ZoneListQuery): Promise<ZoneDto[]> {
    const base = this.visible(ctx);
    if (!base) return [];
    const and: Prisma.ZoneWhereInput[] = [base];
    if (q.status) and.push({ status: q.status });
    if (q.state) and.push({ state: { equals: q.state, mode: 'insensitive' } });
    if (q.q) {
      const like = escapeLike(q.q);
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { code: { contains: like, mode: 'insensitive' } },
          { city: { contains: like, mode: 'insensitive' } },
        ],
      });
    }
    if (q.after) and.push({ id: { gt: q.after } });
    const rows = await this.db.zone.findMany({
      where: { AND: and },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      select: zoneSelect,
    });
    return rows.map(toDto);
  }

  async statusCounts(ctx: AuthContext): Promise<Record<ZoneDto['status'], number>> {
    const out = { UPCOMING: 0, ACTIVE: 0, INACTIVE: 0 };
    const where = this.visible(ctx);
    if (!where) return out;
    const rows = await this.db.zone.groupBy({ by: ['status'], where, _count: { _all: true } });
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  }

  async listIds(ctx: AuthContext): Promise<string[]> {
    const where = this.visible(ctx);
    if (!where) return [];
    const rows = await this.db.zone.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async findById(ctx: AuthContext, id: string): Promise<ZoneDto | null> {
    const where = this.visible(ctx);
    if (!where) return null;
    const row = await this.db.zone.findFirst({
      where: { AND: [where, { id }] },
      select: zoneSelect,
    });
    return row ? toDto(row) : null;
  }

  async pincodePage(
    ctx: AuthContext,
    zoneId: string,
    page: { skip: number; take: number; prefix?: string | undefined },
  ): Promise<{
    rows: { pincode: string; source: PincodeSource; createdAt: Date }[];
    total: number;
  }> {
    if (!this.visible(ctx)) return { rows: [], total: 0 };
    const where: Prisma.ServiceablePincodeWhereInput = {
      zoneId,
      ...(page.prefix ? { pincode: { startsWith: page.prefix } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.serviceablePincode.findMany({
        where,
        orderBy: { pincode: 'asc' },
        skip: page.skip,
        take: page.take,
        select: { pincode: true, source: true, createdAt: true },
      }),
      this.db.serviceablePincode.count({ where }),
    ]);
    return { rows, total };
  }

  /** The zone that owns a pincode (live overlap hint), or null. */
  async ownerOf(
    ctx: AuthContext,
    pincode: string,
  ): Promise<{ id: string; name: string; code: string; status: ZoneDto['status'] } | null> {
    const where = this.visible(ctx);
    if (!where) return null;
    const row = await this.db.serviceablePincode.findFirst({
      where: { pincode, zone: where },
      select: { zone: { select: { id: true, name: true, code: true, status: true } } },
    });
    return row?.zone ?? null;
  }

  // ---- inside a write transaction -----------------------------------------------------------------------------------

  /**
   * Serialises every pincode change (doc 53 section 3): two Super Admins cannot interleave overlap checks. Held until the
   * transaction ends; the UNIQUE(pincode) index stays the final safety net.
   */
  async lockPincodes(ctx: AuthContext): Promise<void> {
    this.writable(ctx);
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('zones.pincodes'))`;
  }

  /** Pincodes from the list that another zone (not `exceptZoneId`) already owns, with that zone's name. */
  async findOwners(
    ctx: AuthContext,
    pincodes: readonly string[],
    exceptZoneId?: string,
  ): Promise<PincodeConflict[]> {
    this.writable(ctx);
    if (pincodes.length === 0) return [];
    const rows = await this.db.serviceablePincode.findMany({
      where: {
        pincode: { in: [...pincodes] },
        ...(exceptZoneId ? { zoneId: { not: exceptZoneId } } : {}),
      },
      orderBy: { pincode: 'asc' },
      select: { pincode: true, zone: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({ pincode: r.pincode, zoneId: r.zone.id, zoneName: r.zone.name }));
  }

  async nameTaken(ctx: AuthContext, name: string, exceptZoneId?: string): Promise<boolean> {
    this.writable(ctx);
    const n = await this.db.zone.count({
      where: {
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptZoneId ? { id: { not: exceptZoneId } } : {}),
      },
    });
    return n > 0;
  }

  /** Includes soft-deleted zones: a code is reserved forever (R-ZONE-3). */
  async codeTaken(ctx: AuthContext, code: string): Promise<boolean> {
    this.writable(ctx);
    return (await this.db.zone.count({ where: { code } })) > 0;
  }

  async insertZone(ctx: AuthContext, z: NewZone): Promise<void> {
    this.writable(ctx);
    await this.db.zone.create({
      data: { ...z, createdBy: ctx.userId, updatedBy: ctx.userId },
    });
  }

  async zonePincodes(
    ctx: AuthContext,
    zoneId: string,
  ): Promise<{ pincode: string; source: PincodeSource }[]> {
    this.writable(ctx);
    return this.db.serviceablePincode.findMany({
      where: { zoneId },
      orderBy: { pincode: 'asc' },
      select: { pincode: true, source: true },
    });
  }

  /** For the zone.updated payload: is the zone defined by its range alone? */
  async onlyRangePincodes(ctx: AuthContext, zoneId: string): Promise<boolean> {
    this.writable(ctx);
    const other = await this.db.serviceablePincode.count({
      where: { zoneId, source: { not: 'RANGE' } },
    });
    return other === 0;
  }

  async insertPincodes(
    ctx: AuthContext,
    zoneId: string,
    rows: readonly { id: string; pincode: string; source: PincodeSource }[],
  ): Promise<void> {
    this.writable(ctx);
    if (rows.length === 0) return;
    await this.db.serviceablePincode.createMany({
      data: rows.map((r) => ({ ...r, zoneId, createdBy: ctx.userId, updatedBy: ctx.userId })),
    });
  }

  /** A removed pincode is deleted, not soft-deleted: the global unique index would keep it reserved (R-ZONE-2). */
  async deletePincodes(
    ctx: AuthContext,
    zoneId: string,
    pincodes: readonly string[],
  ): Promise<void> {
    this.writable(ctx);
    if (pincodes.length === 0) return;
    await this.db.serviceablePincode.deleteMany({
      where: { zoneId, pincode: { in: [...pincodes] } },
    });
  }

  /**
   * Optimistic update (R-ZONE-9): bumps `version` only if it still equals `expectedVersion` (null = no check, for
   * pincode edits, which carry no version). Returns the updated zone, or null when the row moved or does not exist.
   */
  async updateZone(
    ctx: AuthContext,
    id: string,
    expectedVersion: number | null,
    changes: ZoneChanges,
  ): Promise<ZoneDto | null> {
    this.writable(ctx);
    const res = await this.db.zone.updateMany({
      where: {
        id,
        deletedAt: null,
        ...(expectedVersion === null ? {} : { version: expectedVersion }),
      },
      data: { ...changes, version: { increment: 1 }, updatedBy: ctx.userId },
    });
    if (res.count !== 1) return null;
    const row = await this.db.zone.findUnique({ where: { id }, select: zoneSelect });
    return row ? toDto(row) : null;
  }

  /** For the write path: the live zone, read inside the transaction. */
  async findLive(ctx: AuthContext, id: string): Promise<ZoneDto | null> {
    this.writable(ctx);
    const row = await this.db.zone.findFirst({
      where: { id, deletedAt: null },
      select: zoneSelect,
    });
    return row ? toDto(row) : null;
  }

  async insertOutbox(ctx: AuthContext, rows: readonly OutboxRow[]): Promise<void> {
    this.writable(ctx);
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }

  /**
   * Interim (doc 32, P11): counted on the tables directly because the Restaurants, Homemakers, Partners, Customers,
   * Orders and Access modules do not exist yet. Each count moves to that module's read-only count method when it lands.
   */
  async historyCounts(ctx: AuthContext, zoneId: string): Promise<ZoneHistoryCounts> {
    this.writable(ctx);
    const where = { zoneId };
    const [restaurants, homemakers, partners, customerAddresses, orders, memberAssignments] =
      await Promise.all([
        this.db.restaurant.count({ where }),
        this.db.homemaker.count({ where }),
        this.db.deliveryPartner.count({ where }),
        this.db.customerAddress.count({ where }),
        this.db.order.count({ where }),
        this.db.adminZoneAssignment.count({ where }),
      ]);
    return { restaurants, homemakers, partners, customerAddresses, orders, memberAssignments };
  }
}

/** The audit service writes through the same transaction as the change (doc 50 section 2.1). */
export interface ZonesTx {
  repo: ZonesRepository;
  audit: AuditTx;
}

export class ZonesDatabase {
  readonly repo: ZonesRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new ZonesRepository(prisma);
  }

  /** 15 s: a pincode write may wait for another one's advisory lock. */
  transaction<T>(fn: (tx: ZonesTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new ZonesRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
