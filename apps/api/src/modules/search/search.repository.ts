import { Prisma, type PrismaClient } from '@prisma/client';
import type { PermissionKey } from '@zoauro/shared';
import { zonesFor, type AuthContext } from '../../lib/authz';

// The only file of the search module (M18, D143) that imports Prisma. Every group is bounded by the zones where the
// member can view that module (zonesFor; customers through an address or order in such a zone, D25); a module the
// member can view nowhere is not queried at all. A typed Indian mobile is matched exactly (E.164); text is matched with
// ILIKE, LIKE wildcards escaped. Read-only.

export type SearchScope = { kind: 'ALL' } | { kind: 'ZONES'; zoneIds: string[] };

const zoneRef = { select: { id: true, name: true, code: true } } as const;

/** `%`, `_` and `\` typed by the member match themselves. */
const like = (text: string) => ({
  contains: text.replace(/[\\%_]/g, (c) => `\\${c}`),
  mode: 'insensitive' as const,
});

export class SearchRepository {
  constructor(private readonly db: PrismaClient) {}

  scope(ctx: AuthContext, key: PermissionKey): SearchScope | null {
    const s = zonesFor(ctx, key);
    if (s.kind === 'ALL') return { kind: 'ALL' };
    return s.zoneIds.length === 0 ? null : { kind: 'ZONES', zoneIds: [...s.zoneIds] };
  }

  private zoneIn(s: SearchScope) {
    return s.kind === 'ALL' ? {} : { zoneId: { in: s.zoneIds } };
  }

  /** Order number contains the text, or the customer's phone is the typed mobile (doc 20). Exact number first. */
  async orders(s: SearchScope, text: string, phone: string | null, take: number) {
    const or: Prisma.OrderWhereInput[] = [{ orderNo: like(text) }];
    if (phone) or.push({ customer: { phone } });
    const rows = await this.db.order.findMany({
      where: { AND: [this.zoneIn(s), { OR: or }] },
      select: {
        id: true,
        orderNo: true,
        status: true,
        placedAt: true,
        zone: zoneRef,
        restaurant: { select: { name: true } },
        homemaker: { select: { name: true } },
      },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: take * 2,
    });
    const exact = text.toUpperCase();
    return rows
      .sort(
        (a, b) =>
          Number(b.orderNo.toUpperCase() === exact) - Number(a.orderNo.toUpperCase() === exact),
      )
      .slice(0, take);
  }

  /** D25: visible through a live address or an order in a scoped zone. Name or email contains, or the exact phone. */
  async customers(s: SearchScope, text: string, phone: string | null, take: number) {
    const visible: Prisma.CustomerWhereInput =
      s.kind === 'ALL'
        ? { deletedAt: null }
        : {
            deletedAt: null,
            OR: [
              { addresses: { some: { zoneId: { in: s.zoneIds }, deletedAt: null } } },
              { orders: { some: { zoneId: { in: s.zoneIds } } } },
            ],
          };
    const or: Prisma.CustomerWhereInput[] = [{ name: like(text) }, { email: like(text) }];
    if (phone) or.push({ phone });
    return this.db.customer.findMany({
      where: { AND: [visible, { OR: or }] },
      select: { id: true, name: true, phone: true, status: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  async vendors(
    module: 'restaurants' | 'homemakers',
    s: SearchScope,
    text: string,
    phone: string | null,
    take: number,
  ) {
    const or = [{ name: like(text) }, { area: like(text) }, ...(phone ? [{ phone }] : [])];
    const args = {
      where: { AND: [{ deletedAt: null }, this.zoneIn(s), { OR: or }] },
      select: { id: true, name: true, area: true, phone: true, status: true, zone: zoneRef },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take,
    };
    return module === 'restaurants'
      ? this.db.restaurant.findMany(args)
      : this.db.homemaker.findMany(args);
  }

  /** Name contains, vehicle number contains (spaces and dashes ignored), or the exact phone. */
  async partners(s: SearchScope, text: string, phone: string | null, take: number) {
    const vehicle = text.replace(/[\s-]/g, '').toUpperCase();
    const or: Prisma.DeliveryPartnerWhereInput[] = [
      { name: like(text) },
      { vehicleNo: like(vehicle) },
    ];
    if (phone) or.push({ phone });
    return this.db.deliveryPartner.findMany({
      where: { AND: [{ deletedAt: null }, this.zoneIn(s), { OR: or }] },
      select: { id: true, name: true, vehicleNo: true, phone: true, status: true, zone: zoneRef },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }
}
