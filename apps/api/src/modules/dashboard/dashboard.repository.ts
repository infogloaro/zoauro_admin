import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';

/**
 * M16 dashboard aggregates (doc 09 `/dashboard`, docs 20/39). Only the
 * tables that exist in the schema are counted; order/revenue aggregates
 * arrive with M11/M12 and are not faked here.
 *
 * Zone scoping: `zoneIds === null` means every zone (Super Admin today).
 * Restaurant, homemaker and delivery-partner rows are zone-owned (zone_id
 * NOT NULL, doc 08 v2.0). Customer visibility follows D25: a customer is in
 * scope when an address sits in a scoped zone. Sessions are platform-wide
 * (D34 platform health), never zone-filtered.
 */

const NOT_DELETED = { deletedAt: null } as const;

function vendorScope(zoneIds: string[] | null): Prisma.RestaurantWhereInput {
  return { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) };
}

function homemakerScope(zoneIds: string[] | null): Prisma.HomemakerWhereInput {
  return { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) };
}

function partnerScope(zoneIds: string[] | null): Prisma.DeliveryPartnerWhereInput {
  return { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) };
}

function customerScope(zoneIds: string[] | null): Prisma.CustomerWhereInput {
  return {
    ...NOT_DELETED,
    ...(zoneIds ? { addresses: { some: { zoneId: { in: zoneIds } } } } : {}),
  };
}

export interface CountRows {
  customers: number;
  restaurants: number;
  activeRestaurants: number;
  restaurantsPendingVerification: number;
  restaurantsSuspended: number;
  homemakers: number;
  homemakersPendingVerification: number;
  homemakersSuspended: number;
  deliveryPartners: number;
  partnersPendingVerification: number;
  partnersSuspended: number;
}

export async function countAggregates(zoneIds: string[] | null): Promise<CountRows> {
  const [
    customers,
    restaurants,
    activeRestaurants,
    restaurantsPending,
    restaurantsSuspended,
    homemakers,
    homemakersPending,
    homemakersSuspended,
    deliveryPartners,
    partnersPending,
    partnersSuspended,
  ] = await Promise.all([
    prisma.customer.count({ where: customerScope(zoneIds) }),
    prisma.restaurant.count({ where: vendorScope(zoneIds) }),
    prisma.restaurant.count({
      where: { ...vendorScope(zoneIds), status: 'ACTIVE' },
    }),
    prisma.restaurant.count({
      where: { ...vendorScope(zoneIds), verificationStatus: 'PENDING' },
    }),
    prisma.restaurant.count({
      where: { ...vendorScope(zoneIds), status: 'SUSPENDED' },
    }),
    prisma.homemaker.count({ where: homemakerScope(zoneIds) }),
    prisma.homemaker.count({
      where: { ...homemakerScope(zoneIds), verificationStatus: 'PENDING' },
    }),
    prisma.homemaker.count({
      where: { ...homemakerScope(zoneIds), status: 'SUSPENDED' },
    }),
    prisma.deliveryPartner.count({ where: partnerScope(zoneIds) }),
    prisma.deliveryPartner.count({
      where: { ...partnerScope(zoneIds), status: 'PENDING_VERIFICATION' },
    }),
    prisma.deliveryPartner.count({
      where: { ...partnerScope(zoneIds), status: 'SUSPENDED' },
    }),
  ]);
  return {
    customers,
    restaurants,
    activeRestaurants,
    restaurantsPendingVerification: restaurantsPending,
    restaurantsSuspended,
    homemakers,
    homemakersPendingVerification: homemakersPending,
    homemakersSuspended,
    deliveryPartners,
    partnersPendingVerification: partnersPending,
    partnersSuspended,
  };
}

/** D34: active sessions = not revoked and not expired. Platform-wide. */
export async function countActiveSessions(): Promise<number> {
  return prisma.session.count({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
  });
}

export async function existingZoneIds(requested: string[]): Promise<string[]> {
  const rows = await prisma.zone.findMany({
    where: { id: { in: requested } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

function createdAtRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  // Dates are UTC day bounds; `to` is inclusive of the whole day.
  if (from) filter.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) filter.lte = new Date(`${to}T23:59:59.999Z`);
  return filter;
}

export interface RegistrationRow {
  id: string;
  name: string;
  createdAt: Date;
}

const registrationSelect = { id: true, name: true, createdAt: true } as const;

export async function recentCustomers(
  zoneIds: string[] | null,
  limit: number,
  from?: string,
  to?: string,
): Promise<RegistrationRow[]> {
  const createdAt = createdAtRange(from, to);
  return prisma.customer.findMany({
    where: { ...customerScope(zoneIds), ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: 'desc' },
    select: registrationSelect,
    take: limit,
  });
}

export async function recentRestaurants(
  zoneIds: string[] | null,
  limit: number,
  from?: string,
  to?: string,
): Promise<RegistrationRow[]> {
  const createdAt = createdAtRange(from, to);
  return prisma.restaurant.findMany({
    where: { ...vendorScope(zoneIds), ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: 'desc' },
    select: registrationSelect,
    take: limit,
  });
}

export async function recentDeliveryPartners(
  zoneIds: string[] | null,
  limit: number,
  from?: string,
  to?: string,
): Promise<RegistrationRow[]> {
  const createdAt = createdAtRange(from, to);
  return prisma.deliveryPartner.findMany({
    where: { ...partnerScope(zoneIds), ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: 'desc' },
    select: registrationSelect,
    take: limit,
  });
}
