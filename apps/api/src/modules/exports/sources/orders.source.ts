import { MAX_PAGE_SIZE, orderListQuerySchema, type OrderListItem } from '@zoauro/shared';
import { defineExportSource, rupees, type ExportSource } from '../../../lib/exports';
import { parseBody } from '../../../lib/errors';
import type { OrdersService } from '../../orders';

// GET /orders/export (doc 09): the rows GET /orders would list for the same query and zones, every page, through the
// orders service itself (zone scope in its repository, phone masked by its mapper, D26). Sort and filters are the
// list's; page and pageSize are the export's own.

export function ordersExportSource(orders: Pick<OrdersService, 'list'>): ExportSource {
  return defineExportSource({
    module: 'orders',
    viewKey: 'orders:view',
    audit: { module: 'orders', action: 'order.exported' },
    parse: (raw) => parseBody(orderListQuerySchema, raw),
    count: async (ctx, q) => (await orders.list(ctx, { ...q, page: 1, pageSize: 1 })).meta.total,
    page: async (ctx, q, page) =>
      (await orders.list(ctx, { ...q, page, pageSize: MAX_PAGE_SIZE })).data,
    filename: (at) => `orders-${at.toISOString().slice(0, 10)}.csv`,
    columns: (lookups) => [
      { header: 'Order no', value: (o: OrderListItem) => o.orderNo },
      { header: 'Placed at (UTC)', value: (o: OrderListItem) => o.placedAt },
      { header: 'Zone', value: (o: OrderListItem) => lookups.zoneName(o.zoneId) },
      { header: 'Status', value: (o: OrderListItem) => o.status },
      { header: 'Vendor type', value: (o: OrderListItem) => o.vendorType },
      { header: 'Vendor', value: (o: OrderListItem) => o.vendorName },
      { header: 'Customer', value: (o: OrderListItem) => o.customerName },
      { header: 'Customer phone', value: (o: OrderListItem) => o.customerPhoneMasked },
      { header: 'Items', value: (o: OrderListItem) => o.itemCount },
      { header: 'Total (INR)', value: (o: OrderListItem) => rupees(o.total) },
      { header: 'Total (paise)', value: (o: OrderListItem) => o.total },
      { header: 'Payment method', value: (o: OrderListItem) => o.paymentMethod },
      { header: 'Payment status', value: (o: OrderListItem) => o.paymentStatus },
      { header: 'Order id', value: (o: OrderListItem) => o.id },
    ],
  });
}
