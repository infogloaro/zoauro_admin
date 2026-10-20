import type {
  AuditActionKey,
  HotelCounts,
  HotelCreateInput,
  HotelDetail,
  HotelListItem,
  HotelListQuery,
  HotelStatusInput,
  HotelUpdateInput,
  HotelVerificationInput,
  ZoneServiceKind,
} from '@zoauro/shared';
import { maskEmail, maskPhone, record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import {
  assertStatusTransition,
  assertVerificationDecision,
  statusAction,
} from '../vendors/vendor.state';
import {
  isoDay,
  type HotelRecord,
  type HotelsDatabase,
  type HotelsTx,
  type HotelWrite,
} from './hotels.repository';

// Hotels (D91, D118, D127). Hotels follow the vendor lifecycle (status + verification, doc 10 section 4, the vendor
// state machine). The route checks the hotels permission somewhere; this service checks the hotel's zone (404 outside
// the scope, 403 for a missing action). Commission is Super Admin only (doc 04); a new hotel needs the zone's
// HOTEL_BOOKING service (D92: 409 ZONE_SERVICE_DISABLED). Phones and emails are masked (D26).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to do this');

export interface HotelsDeps {
  db: HotelsDatabase;
  /** the zones module (D92) */
  services: { assertServiceEnabled(zoneId: string, service: ZoneServiceKind): Promise<void> };
  clock: () => Date;
}

export class HotelsService {
  constructor(private readonly deps: HotelsDeps) {}

  async list(
    ctx: AuthContext,
    q: HotelListQuery,
  ): Promise<{
    data: HotelListItem[];
    meta: { page: number; pageSize: number; total: number; counts: HotelCounts };
  }> {
    const repo = this.deps.db.repo;
    const [{ rows, total }, counts] = await Promise.all([
      repo.listHotels(ctx, q),
      repo.hotelCounts(ctx, q),
    ]);
    const occupied = await repo.occupiedRooms(
      rows.map((r) => r.id),
      isoDay(this.deps.clock()),
    );
    return {
      data: rows.map((h) => listItem(h, occupied.get(h.id) ?? 0)),
      meta: { page: q.page, pageSize: q.pageSize, total, counts },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<HotelDetail> {
    const h = await this.deps.db.repo.findHotel(ctx, id);
    if (!h) throw notFound();
    return this.toDetail(h);
  }

  async create(ctx: AuthContext, input: HotelCreateInput): Promise<HotelDetail> {
    assertCanWrite(ctx, 'hotels:add', input.zoneId);
    if (input.commissionPct !== undefined && !ctx.isSuperAdmin) throw forbidden();
    if (!(await this.deps.db.repo.zoneRef(input.zoneId))) throw notFound();
    await this.deps.services.assertServiceEnabled(input.zoneId, 'HOTEL_BOOKING');
    const id = uuidv7();
    const h = await this.deps.db.transaction(async (tx) => {
      await tx.repo.insertHotel({ ...writeOf(input), ...input, id, createdBy: ctx.userId });
      const created = await reload(tx, id);
      await audit(tx, created, 'hotel.created', undefined, auditView(created));
      return created;
    });
    return this.toDetail(h);
  }

  async update(ctx: AuthContext, id: string, input: HotelUpdateInput): Promise<HotelDetail> {
    const before = await this.writable(ctx, id, 'hotels:edit');
    if (input.commissionPct !== undefined && !ctx.isSuperAdmin) throw forbidden();
    const h = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockHotel(id);
      await tx.repo.updateHotel(id, writeOf(input), ctx.userId);
      const after = await reload(tx, id);
      const { commissionPct: _b, ...restBefore } = auditView(before);
      const { commissionPct: _a, ...restAfter } = auditView(after);
      void _b;
      void _a;
      await audit(tx, after, 'hotel.updated', restBefore, restAfter);
      if (after.commissionPct !== before.commissionPct)
        await audit(
          tx,
          after,
          'hotel.commission_changed',
          { commissionPct: before.commissionPct },
          { commissionPct: after.commissionPct },
        );
      return after;
    });
    return this.toDetail(h);
  }

  async setStatus(ctx: AuthContext, id: string, input: HotelStatusInput): Promise<HotelDetail> {
    const before = await this.writable(ctx, id, 'hotels:status');
    assertStatusTransition(before.status, before.verificationStatus, input.status);
    const h = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockHotel(id);
      const current = await reload(tx, id);
      assertStatusTransition(current.status, current.verificationStatus, input.status);
      await tx.repo.updateHotel(id, { status: input.status }, ctx.userId);
      const after = await reload(tx, id);
      await audit(
        tx,
        after,
        `hotel.${statusAction(input.status)}` as AuditActionKey,
        { status: current.status },
        { status: after.status },
        input.reason,
      );
      return after;
    });
    return this.toDetail(h);
  }

  async verify(ctx: AuthContext, id: string, input: HotelVerificationInput): Promise<HotelDetail> {
    const before = await this.writable(ctx, id, 'hotels:status');
    assertVerificationDecision(before.verificationStatus, input.decision);
    const verified = input.decision === 'VERIFIED';
    const h = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockHotel(id);
      const current = await reload(tx, id);
      assertVerificationDecision(current.verificationStatus, input.decision);
      await tx.repo.updateHotel(
        id,
        {
          verificationStatus: input.decision,
          verificationNote: verified ? null : (input.note ?? null),
          verifiedAt: verified ? this.deps.clock() : null,
          verifiedBy: verified ? ctx.userId : null,
        },
        ctx.userId,
      );
      const after = await reload(tx, id);
      await audit(
        tx,
        after,
        verified ? 'hotel.verified' : 'hotel.rejected',
        { verificationStatus: current.verificationStatus },
        { verificationStatus: after.verificationStatus },
        input.note,
      );
      return after;
    });
    return this.toDetail(h);
  }

  /** Soft delete; an active hotel is deactivated first (as vendors). */
  async remove(ctx: AuthContext, id: string): Promise<void> {
    const before = await this.writable(ctx, id, 'hotels:delete');
    if (before.status === 'ACTIVE')
      throw new AppError('INVALID_STATE_TRANSITION', 'Deactivate the hotel before deleting it');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockHotel(id);
      const current = await reload(tx, id);
      if (current.status === 'ACTIVE')
        throw new AppError('INVALID_STATE_TRANSITION', 'Deactivate the hotel before deleting it');
      await tx.repo.updateHotel(id, { deletedAt: this.deps.clock() }, ctx.userId);
      await audit(tx, current, 'hotel.deleted', auditView(current), undefined);
    });
  }

  private async writable(
    ctx: AuthContext,
    id: string,
    key: 'hotels:edit' | 'hotels:status' | 'hotels:delete',
  ): Promise<HotelRecord> {
    const h = await this.deps.db.repo.findHotel(ctx, id);
    if (!h) throw notFound();
    assertCanWrite(ctx, key, h.zoneId);
    return h;
  }

  private async toDetail(h: HotelRecord): Promise<HotelDetail> {
    const occupied = await this.deps.db.repo.occupiedRooms([h.id], isoDay(this.deps.clock()));
    return {
      ...listItem(h, occupied.get(h.id) ?? 0),
      address: h.address,
      commissionPct: h.commissionPct,
      gstNo: h.gstNo,
      verificationNote: h.verificationNote,
      verifiedAt: h.verifiedAt?.toISOString() ?? null,
      verifiedBy: h.verifier,
    };
  }
}

async function reload(tx: HotelsTx, id: string): Promise<HotelRecord> {
  const h = await tx.repo.getHotel(id);
  if (!h) throw notFound();
  return h;
}

function audit(
  tx: HotelsTx,
  h: HotelRecord,
  action: AuditActionKey,
  before: unknown,
  after: unknown,
  note?: string,
): Promise<void> {
  return record(tx.audit, {
    module: 'hotels',
    action,
    entity: { type: 'hotel', id: h.id, label: h.name, zoneId: h.zoneId },
    before,
    after,
    ...(note ? { note } : {}),
  });
}

/** What the audit trail keeps (phone and email are masked by the audit redaction policy). */
function auditView(h: HotelRecord) {
  return {
    name: h.name,
    ownerName: h.ownerName,
    phone: h.phone,
    email: h.email,
    address: h.address,
    area: h.area,
    totalRooms: h.totalRooms,
    commissionPct: h.commissionPct,
    gstNo: h.gstNo,
  };
}

function writeOf(i: HotelCreateInput | HotelUpdateInput): HotelWrite {
  const w: HotelWrite = {};
  if (i.name !== undefined) w.name = i.name;
  if (i.ownerName !== undefined) w.ownerName = i.ownerName;
  if (i.phone !== undefined) w.phone = i.phone;
  if (i.email !== undefined) w.email = i.email;
  if (i.address !== undefined) w.address = i.address;
  if (i.area !== undefined) w.area = i.area;
  if (i.totalRooms !== undefined) w.totalRooms = i.totalRooms;
  if (i.commissionPct !== undefined) w.commissionPct = i.commissionPct;
  if (i.gstNo !== undefined) w.gstNo = i.gstNo;
  return w;
}

function listItem(h: HotelRecord, occupiedRooms: number): HotelListItem {
  return {
    id: h.id,
    zone: h.zone,
    name: h.name,
    ownerName: h.ownerName,
    phone: maskPhone(h.phone),
    email: h.email === null ? null : maskEmail(h.email),
    area: h.area,
    totalRooms: h.totalRooms,
    occupiedRooms,
    status: h.status,
    verificationStatus: h.verificationStatus,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}
