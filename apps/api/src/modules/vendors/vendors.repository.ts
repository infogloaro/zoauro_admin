import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  PermissionKey,
  RestaurantKind,
  VendorDocumentType,
  VendorListQuery,
  VendorModule,
  VendorStatus,
  VerificationStatus,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the vendors module that imports Prisma. Restaurants and homemakers are separate tables with one
// route set (doc 09), so every method takes the module. Reads are bounded by zonesFor(ctx, '<module>:<action>'): a
// Zonal Admin sees only rows in zones where they hold the permission; a vendor without a zone (an app sign-up waiting
// for assignment, doc 08 v2.0) is visible to a Super Admin only. Ported from Chittra Priya's branch.

export const VENDOR_TYPE_OF: Record<VendorModule, 'RESTAURANT' | 'HOMEMAKER'> = {
  restaurants: 'RESTAURANT',
  homemakers: 'HOMEMAKER',
};

const commonSelect = {
  id: true,
  zoneId: true,
  zoneAssignmentStatus: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  area: true,
  lat: true,
  lng: true,
  commissionPct: true,
  status: true,
  verificationStatus: true,
  verificationNote: true,
  verifiedAt: true,
  openingHoursJson: true,
  minOrder: true,
  fssaiNo: true,
  isOpen: true,
  source: true,
  sourceUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  zone: { select: { id: true, name: true, code: true } },
  verifier: { select: { id: true, name: true } },
} as const;
const restaurantSelect = {
  ...commonSelect,
  ownerName: true,
  cuisineTags: true,
  kind: true,
  gstNo: true,
  logoKey: true,
} as const;
const homemakerSelect = {
  ...commonSelect,
  specialityTags: true,
  foodCategory: true,
  experienceYears: true,
  isAvailable: true,
  dailyCapacity: true,
  photoKey: true,
} as const;
type RestaurantRow = Prisma.RestaurantGetPayload<{ select: typeof restaurantSelect }>;
type HomemakerRow = Prisma.HomemakerGetPayload<{ select: typeof homemakerSelect }>;

/** One shape for both tables; the module-specific fields are null/empty on the other module. */
export interface VendorRecord {
  module: VendorModule;
  id: string;
  zoneId: string | null;
  zone: { id: string; name: string; code: string } | null;
  assignment: 'ASSIGNED' | 'UNASSIGNED';
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  commissionPct: number;
  status: VendorStatus;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  verifiedAt: Date | null;
  verifier: { id: string; name: string } | null;
  openingHours: unknown;
  minOrder: number;
  fssaiNo: string | null;
  isOpen: boolean;
  source: 'APP' | 'ADMIN' | 'IMPORT';
  sourceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** cuisine tags (restaurants) or speciality tags (homemakers) */
  tags: string[];
  hasImage: boolean;
  // restaurants
  kind: RestaurantKind;
  ownerName: string | null;
  gstNo: string | null;
  // homemakers
  foodCategory: string | null;
  experienceYears: number | null;
  isAvailable: boolean;
  dailyCapacity: number;
}

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());

function common(r: RestaurantRow | HomemakerRow) {
  return {
    id: r.id,
    zoneId: r.zoneId,
    zone: r.zone,
    assignment: r.zoneAssignmentStatus,
    name: r.name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    area: r.area,
    lat: num(r.lat),
    lng: num(r.lng),
    commissionPct: r.commissionPct.toNumber(),
    status: r.status,
    verificationStatus: r.verificationStatus,
    verificationNote: r.verificationNote,
    verifiedAt: r.verifiedAt,
    verifier: r.verifier,
    openingHours: r.openingHoursJson,
    minOrder: r.minOrder,
    fssaiNo: r.fssaiNo,
    isOpen: r.isOpen,
    source: r.source,
    sourceUpdatedAt: r.sourceUpdatedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const fromRestaurant = (r: RestaurantRow): VendorRecord => ({
  ...common(r),
  module: 'restaurants',
  tags: r.cuisineTags,
  hasImage: r.logoKey !== null,
  kind: r.kind,
  ownerName: r.ownerName,
  gstNo: r.gstNo,
  foodCategory: null,
  experienceYears: null,
  isAvailable: true,
  dailyCapacity: 1,
});
const fromHomemaker = (r: HomemakerRow): VendorRecord => ({
  ...common(r),
  module: 'homemakers',
  tags: r.specialityTags,
  hasImage: r.photoKey !== null,
  kind: 'RESTAURANT',
  ownerName: null,
  gstNo: null,
  foodCategory: r.foodCategory,
  experienceYears: r.experienceYears,
  isAvailable: r.isAvailable,
  dailyCapacity: r.dailyCapacity,
});

/** Fields a write may set; the repository passes on only the ones that exist on the module's table. */
export interface VendorWrite {
  name?: string;
  phone?: string;
  email?: string | null;
  address?: string;
  area?: string | null;
  lat?: number | null;
  lng?: number | null;
  commissionPct?: number;
  minOrder?: number;
  fssaiNo?: string | null;
  openingHours?: unknown;
  status?: VendorStatus;
  verificationStatus?: VerificationStatus;
  verificationNote?: string | null;
  verifiedAt?: Date | null;
  verifiedBy?: string | null;
  zoneId?: string;
  zoneAssignmentStatus?: 'ASSIGNED';
  deletedAt?: Date;
  tags?: string[];
  // restaurants
  kind?: RestaurantKind;
  ownerName?: string;
  gstNo?: string | null;
  // homemakers
  foodCategory?: string | null;
  experienceYears?: number | null;
  isAvailable?: boolean;
  dailyCapacity?: number;
}

export interface VendorDocumentRecord {
  id: string;
  docType: VendorDocumentType;
  fileKey: string;
  verified: boolean;
  rejectionNote: string | null;
  verifier: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string | null;
  payload: Record<string, unknown>;
}

type Where = Prisma.RestaurantWhereInput & Prisma.HomemakerWhereInput;

/** Columns both tables share, as plain values (valid in create and update data alike). */
interface SharedData {
  phone?: string;
  email?: string | null;
  address?: string;
  area?: string | null;
  lat?: number | null;
  lng?: number | null;
  commissionPct?: number;
  minOrder?: number;
  fssaiNo?: string | null;
  openingHoursJson?: Prisma.InputJsonValue | typeof Prisma.DbNull;
  status?: VendorStatus;
  verificationStatus?: VerificationStatus;
  verificationNote?: string | null;
  verifiedAt?: Date | null;
  verifiedBy?: string | null;
  zoneId?: string;
  zoneAssignmentStatus?: 'ASSIGNED';
  deletedAt?: Date;
}

/** `%`, `_` and `\` are literal in the search text. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const json = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

const docSelect = {
  id: true,
  docType: true,
  fileKey: true,
  verified: true,
  rejectionNote: true,
  createdAt: true,
  updatedAt: true,
  verifier: { select: { id: true, name: true } },
} as const;

export class VendorsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /**
   * Rows of `module` the actor may touch with `key`; null = none at all (no query runs). A Super Admin also sees vendors
   * without a zone, unless a zone was requested.
   */
  private scope(ctx: AuthContext, module: VendorModule, action: 'view' | 'edit'): Where | null {
    const scope = zonesFor(ctx, `${module}:${action}` as PermissionKey);
    if (scope.kind === 'ALL') return { deletedAt: null };
    if (scope.zoneIds.length === 0) return null;
    return { deletedAt: null, zoneId: { in: [...scope.zoneIds] } };
  }

  private filters(module: VendorModule, q: VendorListQuery): Where[] {
    const and: Where[] = [];
    if (q.assignment) and.push({ zoneAssignmentStatus: q.assignment });
    if (q.area) and.push({ area: { equals: q.area, mode: 'insensitive' } });
    if (q.tag)
      and.push(
        module === 'restaurants'
          ? { cuisineTags: { has: q.tag } }
          : { specialityTags: { has: q.tag } },
      );
    if (q.q) {
      const like = escapeLike(q.q);
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { phone: { contains: like } },
          { area: { contains: like, mode: 'insensitive' } },
        ],
      });
    }
    return and;
  }

  async list(
    ctx: AuthContext,
    module: VendorModule,
    q: VendorListQuery,
  ): Promise<{ rows: VendorRecord[]; total: number }> {
    const base = this.scope(ctx, module, 'view');
    if (!base) return { rows: [], total: 0 };
    const and = [base, ...this.filters(module, q)];
    if (q.status) and.push({ status: q.status });
    if (q.verification) and.push({ verificationStatus: q.verification });
    const where: Where = { AND: and };
    const orderBy = [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }];
    const skip = (q.page - 1) * q.pageSize;
    if (module === 'restaurants') {
      const [rows, total] = await Promise.all([
        this.db.restaurant.findMany({
          where,
          orderBy,
          skip,
          take: q.pageSize,
          select: restaurantSelect,
        }),
        this.db.restaurant.count({ where }),
      ]);
      return { rows: rows.map(fromRestaurant), total };
    }
    const [rows, total] = await Promise.all([
      this.db.homemaker.findMany({
        where,
        orderBy,
        skip,
        take: q.pageSize,
        select: homemakerSelect,
      }),
      this.db.homemaker.count({ where }),
    ]);
    return { rows: rows.map(fromHomemaker), total };
  }

  /** Tab counts: the list's scope and filters except status and verification. */
  async counts(
    ctx: AuthContext,
    module: VendorModule,
    q: VendorListQuery,
  ): Promise<{
    total: number;
    pendingVerification: number;
    active: number;
    inactive: number;
    suspended: number;
    rejected: number;
  }> {
    const base = this.scope(ctx, module, 'view');
    const zero = {
      total: 0,
      pendingVerification: 0,
      active: 0,
      inactive: 0,
      suspended: 0,
      rejected: 0,
    };
    if (!base) return zero;
    const and = [base, ...this.filters(module, q)];
    const count = (extra: Where): Promise<number> => {
      const where: Where = { AND: [...and, extra] };
      return module === 'restaurants'
        ? this.db.restaurant.count({ where })
        : this.db.homemaker.count({ where });
    };
    const [total, pendingVerification, active, inactive, suspended, rejected] = await Promise.all([
      count({}),
      count({ verificationStatus: 'PENDING' }),
      count({ status: 'ACTIVE' }),
      count({ status: 'INACTIVE' }),
      count({ status: 'SUSPENDED' }),
      count({ verificationStatus: 'REJECTED' }),
    ]);
    return { total, pendingVerification, active, inactive, suspended, rejected };
  }

  /** null for a missing row AND for a row outside the actor's view scope: the caller answers 404 either way. */
  async find(ctx: AuthContext, module: VendorModule, id: string): Promise<VendorRecord | null> {
    const base = this.scope(ctx, module, 'view');
    if (!base) return null;
    const where: Where = { AND: [base, { id }] };
    if (module === 'restaurants') {
      const row = await this.db.restaurant.findFirst({ where, select: restaurantSelect });
      return row ? fromRestaurant(row) : null;
    }
    const row = await this.db.homemaker.findFirst({ where, select: homemakerSelect });
    return row ? fromHomemaker(row) : null;
  }

  /** After the caller authorized the write (or the create): the row by id, unscoped. */
  async get(module: VendorModule, id: string): Promise<VendorRecord | null> {
    if (module === 'restaurants') {
      const row = await this.db.restaurant.findFirst({
        where: { id, deletedAt: null },
        select: restaurantSelect,
      });
      return row ? fromRestaurant(row) : null;
    }
    const row = await this.db.homemaker.findFirst({
      where: { id, deletedAt: null },
      select: homemakerSelect,
    });
    return row ? fromHomemaker(row) : null;
  }

  /** The uploads module's entity check: which vendor table holds `id`, and its zone (unscoped; the caller scopes). */
  async ownerOf(id: string): Promise<{ module: VendorModule; zoneId: string | null } | null> {
    const r = await this.db.restaurant.findFirst({
      where: { id, deletedAt: null },
      select: { zoneId: true },
    });
    if (r) return { module: 'restaurants', zoneId: r.zoneId };
    const h = await this.db.homemaker.findFirst({
      where: { id, deletedAt: null },
      select: { zoneId: true },
    });
    return h ? { module: 'homemakers', zoneId: h.zoneId } : null;
  }

  /** Row lock for a write; the caller has already checked visibility with find(). */
  async lock(module: VendorModule, id: string): Promise<void> {
    if (module === 'restaurants')
      await this.db.$queryRaw`SELECT id FROM restaurants WHERE id = ${id}::uuid FOR UPDATE`;
    else await this.db.$queryRaw`SELECT id FROM homemakers WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async insert(
    module: VendorModule,
    row: VendorWrite & { id: string; zoneId: string; name: string; createdBy: string },
  ): Promise<void> {
    const shared = this.sharedData(row);
    if (module === 'restaurants') {
      await this.db.restaurant.create({
        data: {
          ...shared,
          id: row.id,
          name: row.name,
          zoneId: row.zoneId,
          source: 'ADMIN',
          createdBy: row.createdBy,
          updatedBy: row.createdBy,
          cuisineTags: row.tags ?? [],
          ...(row.kind !== undefined ? { kind: row.kind } : {}),
          ...(row.ownerName !== undefined ? { ownerName: row.ownerName } : {}),
          ...(row.gstNo !== undefined ? { gstNo: row.gstNo } : {}),
        },
      });
      return;
    }
    await this.db.homemaker.create({
      data: {
        ...shared,
        id: row.id,
        name: row.name,
        zoneId: row.zoneId,
        source: 'ADMIN',
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
        specialityTags: row.tags ?? [],
        ...this.homemakerData(row),
      },
    });
  }

  async update(module: VendorModule, id: string, w: VendorWrite, actorId: string): Promise<void> {
    const shared = { ...this.sharedData(w), updatedBy: actorId };
    if (w.name !== undefined) Object.assign(shared, { name: w.name });
    if (module === 'restaurants') {
      await this.db.restaurant.update({
        where: { id },
        data: {
          ...shared,
          ...(w.tags !== undefined ? { cuisineTags: w.tags } : {}),
          ...(w.kind !== undefined ? { kind: w.kind } : {}),
          ...(w.ownerName !== undefined ? { ownerName: w.ownerName } : {}),
          ...(w.gstNo !== undefined ? { gstNo: w.gstNo } : {}),
        },
      });
      return;
    }
    await this.db.homemaker.update({
      where: { id },
      data: {
        ...shared,
        ...(w.tags !== undefined ? { specialityTags: w.tags } : {}),
        ...this.homemakerData(w),
      },
    });
  }

  private sharedData(w: VendorWrite): SharedData {
    const out: SharedData = {};
    if (w.phone !== undefined) out.phone = w.phone;
    if (w.email !== undefined) out.email = w.email;
    if (w.address !== undefined) out.address = w.address;
    if (w.area !== undefined) out.area = w.area;
    if (w.lat !== undefined) out.lat = w.lat;
    if (w.lng !== undefined) out.lng = w.lng;
    if (w.commissionPct !== undefined) out.commissionPct = w.commissionPct;
    if (w.minOrder !== undefined) out.minOrder = w.minOrder;
    if (w.fssaiNo !== undefined) out.fssaiNo = w.fssaiNo;
    if (w.openingHours !== undefined) out.openingHoursJson = json(w.openingHours);
    if (w.status !== undefined) out.status = w.status;
    if (w.verificationStatus !== undefined) out.verificationStatus = w.verificationStatus;
    if (w.verificationNote !== undefined) out.verificationNote = w.verificationNote;
    if (w.verifiedAt !== undefined) out.verifiedAt = w.verifiedAt;
    if (w.verifiedBy !== undefined) out.verifiedBy = w.verifiedBy;
    if (w.zoneId !== undefined) out.zoneId = w.zoneId;
    if (w.zoneAssignmentStatus !== undefined) out.zoneAssignmentStatus = w.zoneAssignmentStatus;
    if (w.deletedAt !== undefined) out.deletedAt = w.deletedAt;
    return out;
  }

  private homemakerData(w: VendorWrite) {
    return {
      ...(w.foodCategory !== undefined ? { foodCategory: w.foodCategory } : {}),
      ...(w.experienceYears !== undefined ? { experienceYears: w.experienceYears } : {}),
      ...(w.isAvailable !== undefined ? { isAvailable: w.isAvailable } : {}),
      ...(w.dailyCapacity !== undefined ? { dailyCapacity: w.dailyCapacity } : {}),
    };
  }

  /** A live zone (target of create or move-zone); null when missing or deleted. */
  async zoneRef(zoneId: string): Promise<{ id: string; name: string; code: string } | null> {
    return this.db.zone.findFirst({
      where: { id: zoneId, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
  }

  async documents(module: VendorModule, vendorId: string): Promise<VendorDocumentRecord[]> {
    const rows = await this.db.vendorDocument.findMany({
      where: { vendorType: VENDOR_TYPE_OF[module], vendorId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: docSelect,
    });
    return rows.map((r) => ({ ...r, docType: r.docType as VendorDocumentType }));
  }

  async document(
    module: VendorModule,
    vendorId: string,
    docId: string,
  ): Promise<VendorDocumentRecord | null> {
    const r = await this.db.vendorDocument.findFirst({
      where: { id: docId, vendorType: VENDOR_TYPE_OF[module], vendorId, deletedAt: null },
      select: docSelect,
    });
    return r ? { ...r, docType: r.docType as VendorDocumentType } : null;
  }

  async insertDocument(
    module: VendorModule,
    row: {
      id: string;
      vendorId: string;
      docType: VendorDocumentType;
      fileKey: string;
      createdBy: string;
    },
  ): Promise<void> {
    await this.db.vendorDocument.create({
      data: {
        id: row.id,
        vendorType: VENDOR_TYPE_OF[module],
        vendorId: row.vendorId,
        docType: row.docType,
        fileKey: row.fileKey,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      },
    });
  }

  async reviewDocument(
    docId: string,
    review: { verified: boolean; rejectionNote: string | null; verifiedBy: string },
  ): Promise<void> {
    await this.db.vendorDocument.update({
      where: { id: docId },
      data: { ...review, updatedBy: review.verifiedBy },
    });
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

export interface VendorsTx {
  repo: VendorsRepository;
  audit: AuditTx;
}

export class VendorsDatabase {
  readonly repo: VendorsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new VendorsRepository(prisma);
  }

  transaction<T>(fn: (tx: VendorsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new VendorsRepository(tx), audit: auditTx(tx) }),
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }
}
