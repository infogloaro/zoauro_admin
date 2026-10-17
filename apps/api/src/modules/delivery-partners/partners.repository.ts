import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  PartnerDocumentType,
  PartnerListQuery,
  PartnerStatus,
  VerificationStatus,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { BaseRepository, type AuthContext, type ScopedDelegate } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the delivery-partners module (M10, R12) that imports Prisma. Reads are bounded by
// zonesFor(ctx, 'delivery:view') through BaseRepository (a Super Admin with no zone requested also sees the unzoned
// app sign-ups, D53); a row the actor cannot see is "not found". Documents live in vendor_documents with vendor_type
// DELIVERY_PARTNER (D131).

export const PARTNER_DOC_OWNER = 'DELIVERY_PARTNER';

const partnerSelect = {
  id: true,
  zoneId: true,
  zone: { select: { id: true, name: true, code: true } },
  zoneAssignmentStatus: true,
  name: true,
  phone: true,
  email: true,
  vehicleType: true,
  vehicleNo: true,
  area: true,
  status: true,
  verificationStatus: true,
  verificationNote: true,
  verifiedAt: true,
  verifier: { select: { id: true, name: true } },
  isOnline: true,
  forceOfflineUntil: true,
  currentOrders: true,
  cashInHand: true,
  ratingAvg: true,
  deliveriesCount: true,
  source: true,
  sourceUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.DeliveryPartnerSelect;
export type PartnerRecord = Prisma.DeliveryPartnerGetPayload<{ select: typeof partnerSelect }>;

const docSelect = {
  id: true,
  docType: true,
  fileKey: true,
  verified: true,
  rejectionNote: true,
  verifier: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VendorDocumentSelect;
export type PartnerDocumentRecord = Omit<
  Prisma.VendorDocumentGetPayload<{ select: typeof docSelect }>,
  'docType'
> & { docType: PartnerDocumentType };

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string | null;
  payload: Record<string, unknown>;
}

type Where = Prisma.DeliveryPartnerWhereInput;

const SORT_COLUMN = {
  createdAt: 'createdAt',
  name: 'name',
  area: 'area',
  status: 'status',
  currentOrders: 'currentOrders',
} as const;

export interface PartnerWrite {
  name?: string;
  phone?: string;
  email?: string | null;
  vehicleType?: string | null;
  vehicleNo?: string | null;
  area?: string | null;
  status?: PartnerStatus;
  verificationStatus?: VerificationStatus;
  verificationNote?: string | null;
  verifiedAt?: Date | null;
  verifiedBy?: string | null;
  forceOfflineUntil?: Date | null;
  isOnline?: boolean;
  zoneId?: string;
  zoneAssignmentStatus?: 'ASSIGNED' | 'UNASSIGNED';
}

export class PartnersRepository extends BaseRepository<Where, PartnerRecord> {
  constructor(private readonly db: Prisma.TransactionClient) {
    const delegate: ScopedDelegate<Where, PartnerRecord> = {
      findMany: (a) => db.deliveryPartner.findMany({ ...a, select: partnerSelect }),
      findFirst: (a) => db.deliveryPartner.findFirst({ ...a, select: partnerSelect }),
      count: (a) => db.deliveryPartner.count(a),
    };
    super(delegate, 'delivery:view');
  }

  protected zoneFilter(zoneIds: readonly string[]): Where {
    return { zoneId: { in: [...zoneIds] } };
  }

  protected idFilter(id: string): Where {
    return { id, deletedAt: null };
  }

  /** Filters except status and verification (the list tabs count across those). */
  private filters(q: PartnerListQuery, now: Date): Where[] {
    const and: Where[] = [{ deletedAt: null }];
    if (q.assignment) and.push({ zoneAssignmentStatus: q.assignment });
    if (q.online !== undefined) and.push({ isOnline: q.online });
    if (q.vehicleType) and.push({ vehicleType: { equals: q.vehicleType, mode: 'insensitive' } });
    if (q.area) and.push({ area: { equals: q.area, mode: 'insensitive' } });
    if (q.available) and.push(assignableWhere(now));
    if (q.q) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({
        OR: [{ name: contains }, { phone: contains }, { vehicleNo: contains }, { area: contains }],
      });
    }
    return and;
  }

  async list(
    ctx: AuthContext,
    q: PartnerListQuery,
    now: Date,
  ): Promise<{
    rows: PartnerRecord[];
    total: number;
    counts: Record<
      'total' | 'pendingVerification' | 'active' | 'inactive' | 'suspended' | 'rejected' | 'onDuty',
      number
    >;
  }> {
    const base = this.scope(ctx, this.viewPermission, { AND: this.filters(q, now) });
    if (base === null)
      return {
        rows: [],
        total: 0,
        counts: {
          total: 0,
          pendingVerification: 0,
          active: 0,
          inactive: 0,
          suspended: 0,
          rejected: 0,
          onDuty: 0,
        },
      };
    const tabs: Where[] = [];
    if (q.status) tabs.push({ status: q.status });
    if (q.verification) tabs.push({ verificationStatus: q.verification });
    const where: Where = tabs.length > 0 ? { AND: [base, ...tabs] } : base;
    const field = SORT_COLUMN[q.sort.field as keyof typeof SORT_COLUMN];
    const count = (extra: Where) =>
      this.db.deliveryPartner.count({ where: { AND: [base, extra] } });
    const [rows, total, all, pending, active, inactive, suspended, rejected, onDuty] =
      await Promise.all([
        this.db.deliveryPartner.findMany({
          where,
          select: partnerSelect,
          orderBy: [{ [field]: q.sort.direction }, { id: q.sort.direction }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.db.deliveryPartner.count({ where }),
        count({}),
        count({ verificationStatus: 'PENDING' }),
        count({ status: 'ACTIVE' }),
        count({ status: 'INACTIVE' }),
        count({ status: 'SUSPENDED' }),
        count({ verificationStatus: 'REJECTED' }),
        count(assignableWhere(now)),
      ]);
    return {
      rows,
      total,
      counts: {
        total: all,
        pendingVerification: pending,
        active,
        inactive,
        suspended,
        rejected,
        onDuty,
      },
    };
  }

  /** In the actor's view scope, else null (404). */
  find(ctx: AuthContext, id: string): Promise<PartnerRecord | null> {
    return this.findOneScoped(ctx, id);
  }

  /** After the caller authorized the write: the live row by id, unscoped. */
  get(id: string): Promise<PartnerRecord | null> {
    return this.db.deliveryPartner.findFirst({
      where: { id, deletedAt: null },
      select: partnerSelect,
    });
  }

  async lock(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM delivery_partners WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Doc 22: phone unique among live partners (no database constraint: checked here, under the row lock). */
  async phoneTaken(phone: string, exceptId: string | null): Promise<boolean> {
    const n = await this.db.deliveryPartner.count({
      where: { phone, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    return n > 0;
  }

  async insert(row: {
    id: string;
    zoneId: string;
    name: string;
    phone: string;
    email: string | null;
    vehicleType: string | null;
    vehicleNo: string | null;
    area: string | null;
    createdBy: string;
  }): Promise<void> {
    await this.db.deliveryPartner.create({
      data: { ...row, source: 'ADMIN', updatedBy: row.createdBy },
    });
  }

  /** Version-locked update (D130); false when another write got there first. */
  async update(id: string, version: number, data: PartnerWrite, userId: string): Promise<boolean> {
    const r = await this.db.deliveryPartner.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, updatedBy: userId, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  /** Under the row lock: write and bump the version. */
  async set(id: string, data: PartnerWrite, userId: string): Promise<void> {
    await this.db.deliveryPartner.update({
      where: { id },
      data: { ...data, updatedBy: userId, version: { increment: 1 } },
    });
  }

  async softDelete(id: string, userId: string, at: Date): Promise<void> {
    await this.db.deliveryPartner.update({
      where: { id },
      data: { deletedAt: at, isOnline: false, updatedBy: userId, version: { increment: 1 } },
    });
  }

  /** Orders the partner carries now (doc 35 ZA-3.1: assigned orders, read-only). */
  async openOrders(id: string) {
    return this.db.order.findMany({
      where: { deliveryPartnerId: id, status: { in: ['ASSIGNED', 'OUT_FOR_DELIVERY'] } },
      select: { id: true, orderNo: true, status: true, placedAt: true },
      orderBy: { placedAt: 'asc' },
      take: 50,
    });
  }

  async zone(id: string): Promise<{ id: string; name: string; code: string } | null> {
    return this.db.zone.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
  }

  async documents(partnerId: string): Promise<PartnerDocumentRecord[]> {
    const rows = await this.db.vendorDocument.findMany({
      where: { vendorType: PARTNER_DOC_OWNER, vendorId: partnerId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: docSelect,
    });
    return rows.map((r) => ({ ...r, docType: r.docType as PartnerDocumentType }));
  }

  async document(partnerId: string, docId: string): Promise<PartnerDocumentRecord | null> {
    const r = await this.db.vendorDocument.findFirst({
      where: { id: docId, vendorType: PARTNER_DOC_OWNER, vendorId: partnerId, deletedAt: null },
      select: docSelect,
    });
    return r ? { ...r, docType: r.docType as PartnerDocumentType } : null;
  }

  async insertDocument(row: {
    id: string;
    partnerId: string;
    docType: PartnerDocumentType;
    fileKey: string;
    createdBy: string;
  }): Promise<void> {
    await this.db.vendorDocument.create({
      data: {
        id: row.id,
        vendorType: PARTNER_DOC_OWNER,
        vendorId: row.partnerId,
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

  /** For the uploads module (D120/D131): who owns a partner id, unscoped. */
  async ownerOf(id: string): Promise<{ module: 'delivery'; zoneId: string | null } | null> {
    const p = await this.db.deliveryPartner.findFirst({
      where: { id, deletedAt: null },
      select: { zoneId: true },
    });
    return p ? { module: 'delivery', zoneId: p.zoneId } : null;
  }
}

/** D133 / doc 44: online, ACTIVE, VERIFIED, not forced offline. */
export function assignableWhere(now: Date): Where {
  return {
    isOnline: true,
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    OR: [{ forceOfflineUntil: null }, { forceOfflineUntil: { lte: now } }],
  };
}

export interface PartnersTx {
  repo: PartnersRepository;
  audit: AuditTx;
}

export class PartnersDatabase {
  readonly repo: PartnersRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new PartnersRepository(prisma);
  }

  transaction<T>(fn: (tx: PartnersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new PartnersRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
