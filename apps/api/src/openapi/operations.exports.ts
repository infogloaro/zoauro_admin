import type { z } from 'zod';
import {
  bookingListQuerySchema,
  customerListQuerySchema,
  diningListQuerySchema,
  EXPORT_LIST_PATHS,
  exportIdParamsSchema,
  exportJobSchema,
  hotelListQuerySchema,
  menuItemListQuerySchema,
  notificationListQuerySchema,
  orderListQuerySchema,
  partnerListQuerySchema,
  paymentListQuerySchema,
  payoutListQuerySchema,
  refundListQuerySchema,
  ticketListQuerySchema,
  vendorListQuerySchema,
  type ExportModule,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// Export jobs (doc 09 GET /orders/export, GET /exports/{id}; D129, D149: every list). One GET <list>/export per list
// with an export source; the query is the list's own (page and pageSize are ignored). Kept apart from operations.ts.

const LISTS: { module: ExportModule; operationId: string; label: string; query: z.ZodObject }[] = [
  { module: 'orders', operationId: 'exportOrders', label: 'orders', query: orderListQuerySchema },
  {
    module: 'restaurants',
    operationId: 'exportRestaurants',
    label: 'restaurants',
    query: vendorListQuerySchema,
  },
  {
    module: 'homemakers',
    operationId: 'exportHomemakers',
    label: 'home-food vendors',
    query: vendorListQuerySchema,
  },
  {
    module: 'menu',
    operationId: 'exportMenuItems',
    label: 'menu items',
    query: menuItemListQuerySchema,
  },
  {
    module: 'delivery',
    operationId: 'exportPartners',
    label: 'delivery partners',
    query: partnerListQuerySchema,
  },
  {
    module: 'customers',
    operationId: 'exportCustomers',
    label: 'customers',
    query: customerListQuerySchema,
  },
  {
    module: 'notifications',
    operationId: 'exportNotifications',
    label: 'notifications',
    query: notificationListQuerySchema,
  },
  {
    module: 'support',
    operationId: 'exportTickets',
    label: 'support tickets',
    query: ticketListQuerySchema,
  },
  { module: 'hotels', operationId: 'exportHotels', label: 'hotels', query: hotelListQuerySchema },
  {
    module: 'bookings',
    operationId: 'exportRoomBookings',
    label: 'room bookings',
    query: bookingListQuerySchema,
  },
  {
    module: 'dining',
    operationId: 'exportDiningReservations',
    label: 'dining reservations',
    query: diningListQuerySchema,
  }, // F4b: the money lists (their export permission, the zone's export switch for Zonal Admins, D149)
  {
    module: 'payments',
    operationId: 'exportPayments',
    label: 'payments',
    query: paymentListQuerySchema,
  },
  {
    module: 'refunds',
    operationId: 'exportRefunds',
    label: 'refunds',
    query: refundListQuerySchema,
  },
  {
    module: 'payouts',
    operationId: 'exportPayouts',
    label: 'payouts',
    query: payoutListQuerySchema,
  },
];

export const EXPORT_OPERATIONS: OperationDef[] = [
  ...LISTS.flatMap(({ module, operationId, label, query }): OperationDef[] => {
    const path = EXPORT_LIST_PATHS[module];
    if (path === null) return [];
    return [
      {
        operationId,
        method: 'get',
        path: `${path}/export`,
        tags: ['exports'],
        summary: `Start a CSV export of the ${label} list with the same filters and zone scope as GET ${path} (D149). Needs ${module}:export and, for a Zonal Admin, the zone's export switch in every exported zone; at most 3 exports in progress, 100k rows; contacts masked (D26)`,
        access: { kind: 'permission', permission: `${module}:export`, zone: 'query' },
        query,
        response: { status: 202, schema: exportJobSchema, description: 'Export queued' },
        errors: ['RATE_LIMITED'],
      },
    ];
  }),
  {
    operationId: 'getExport',
    method: 'get',
    path: '/exports/{id}',
    tags: ['exports'],
    summary:
      'One export job of the caller: status, row count, and while READY a signed download link valid until expiresAt (24 h). Anyone else’s job is 404',
    access: { kind: 'session' },
    params: exportIdParamsSchema,
    response: { status: 200, schema: exportJobSchema, description: 'The export job' },
    errors: ['NOT_FOUND'],
  },
];
