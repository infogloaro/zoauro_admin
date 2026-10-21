import type {
  DashboardSummary,
  ListDashboardQuery,
  NewRegistrationsQuery,
  NewRegistrationsResponse,
} from '@zoauro/shared';
import { requestedDashboardZoneIds } from '@zoauro/shared';
import { errors } from '../../lib/errors';
import * as repo from './dashboard.repository';

/**
 * M16 dashboard service (doc 09 `/dashboard`, doc 20 row 10, D34).
 * Aggregates are what the database can prove today; the order/revenue
 * half of the doc-20 grid waits on M11/M12 and is surfaced as honest
 * placeholders on the web, never invented here.
 */

/** Effective zone scope for a dashboard request (doc 09 conventions). */
async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

export async function getSummary(query: ListDashboardQuery): Promise<{ data: DashboardSummary }> {
  const zoneIds = await resolveZoneScope(requestedDashboardZoneIds(query));
  const [counts, activeSessions] = await Promise.all([
    repo.countAggregates(zoneIds),
    repo.countActiveSessions(),
  ]);

  const pendingVerification =
    counts.restaurantsPendingVerification +
    counts.homemakersPendingVerification +
    counts.partnersPendingVerification;
  const suspended =
    counts.restaurantsSuspended + counts.homemakersSuspended + counts.partnersSuspended;

  return {
    data: {
      customers: counts.customers,
      restaurants: counts.restaurants,
      activeRestaurants: counts.activeRestaurants,
      homemakers: counts.homemakers,
      deliveryPartners: counts.deliveryPartners,
      pendingVerification,
      suspended,
      platformHealth: { pendingVerifications: pendingVerification, activeSessions },
    },
  };
}

function serializeRegistration(row: repo.RegistrationRow) {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

export async function getNewRegistrations(
  query: NewRegistrationsQuery,
): Promise<NewRegistrationsResponse> {
  const zoneIds = await resolveZoneScope(requestedDashboardZoneIds(query));
  const [customers, restaurants, deliveryPartners] = await Promise.all([
    repo.recentCustomers(zoneIds, query.limit, query.from, query.to),
    repo.recentRestaurants(zoneIds, query.limit, query.from, query.to),
    repo.recentDeliveryPartners(zoneIds, query.limit, query.from, query.to),
  ]);
  return {
    data: {
      customers: customers.map(serializeRegistration),
      restaurants: restaurants.map(serializeRegistration),
      deliveryPartners: deliveryPartners.map(serializeRegistration),
    },
    meta: { limit: query.limit, from: query.from, to: query.to },
  };
}
