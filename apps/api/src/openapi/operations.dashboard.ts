import {
  dashboardNewRegistrationsSchema,
  dashboardOrderOverviewSchema,
  dashboardOrderStatusSchema,
  dashboardQuerySchema,
  dashboardSummarySchema,
  dashboardTopCategoriesSchema,
  dashboardTopVendorsSchema,
  dashboardZoneOrdersSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// M16 Dashboard tiles (doc 09 /dashboard/*, SA-5.1, ZA-5.1). Each tile counts only the zones where the caller can view
// its source module (doc 04 section 4.3) and is null when they can view it nowhere. Money tiles wait for SA-6.7.

const tags = ['dashboard'];
// zone 'none': the tiles list no zones; each tile is bounded by its own module's zones in the service (an unassigned
// ?zoneId is refused with 404 ZONE_NOT_FOUND by the auth context before any route runs). Scope tests: tests/dashboard/
const access = { kind: 'permission', permission: 'dashboard:view', zone: 'none' } as const;
const range = '?range=today|7d|30d|month (IST days, default 7d)';

export const DASHBOARD_OPERATIONS: OperationDef[] = [
  {
    operationId: 'getDashboardSummary',
    method: 'get',
    path: '/dashboard/summary',
    tags,
    summary: `KPIs: orders in the range (unpaid online orders excluded, D52) with the cancellation rate; restaurants, home kitchens, delivery partners (incl. on duty) and customers all-time; Super Admin also zones without a team and platform health (D34). ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardSummarySchema, description: 'The KPIs' },
  },
  {
    operationId: 'getDashboardOrderStatus',
    method: 'get',
    path: '/dashboard/order-status',
    tags,
    summary: `Orders in the range by status (the donut). ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardOrderStatusSchema, description: 'Counts per status' },
  },
  {
    operationId: 'getDashboardOrderOverview',
    method: 'get',
    path: '/dashboard/order-overview',
    tags,
    summary: `Orders and delivered orders per IST hour (today) or day, every bucket present. ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardOrderOverviewSchema, description: 'The series' },
  },
  {
    operationId: 'getDashboardZoneOrders',
    method: 'get',
    path: '/dashboard/zone-orders',
    tags,
    summary: `Orders per zone when the scope has more than one zone, per vendor area for one zone. ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardZoneOrdersSchema, description: 'The bars' },
  },
  {
    operationId: 'getDashboardTopRestaurants',
    method: 'get',
    path: '/dashboard/top-restaurants',
    tags,
    summary: `Top 5 restaurants and home kitchens by delivered orders. ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardTopVendorsSchema, description: 'The top 5' },
  },
  {
    operationId: 'getDashboardTopCategories',
    method: 'get',
    path: '/dashboard/top-categories',
    tags,
    summary: `Top 5 food categories by item quantity of delivered orders. ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardTopCategoriesSchema, description: 'The top 5' },
  },
  {
    operationId: 'getDashboardNewRegistrations',
    method: 'get',
    path: '/dashboard/new-registrations',
    tags,
    summary: `New customers, vendors and delivery partners in the range, with the latest five of each. ${range}`,
    access,
    query: dashboardQuerySchema,
    response: { status: 200, schema: dashboardNewRegistrationsSchema, description: 'The tabs' },
  },
];
