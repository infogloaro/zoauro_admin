import {
  bookingListQuerySchema,
  customerListQuerySchema,
  diningListQuerySchema,
  hotelListQuerySchema,
  menuItemListQuerySchema,
  notificationListQuerySchema,
  offerListQuerySchema,
  offerValueText,
  partnerListQuerySchema,
  ticketListQuerySchema,
  vendorListQuerySchema,
  type BookingListQuery,
  type CustomerListItem,
  type CustomerListQuery,
  type DiningListQuery,
  type DiningReservation,
  type HomemakerListItem,
  type HotelListItem,
  type HotelListQuery,
  type MenuItemListItem,
  type MenuItemListQuery,
  type NotificationListItem,
  type NotificationListQuery,
  type Offer,
  type OfferListQuery,
  type PartnerListItem,
  type PartnerListQuery,
  type RestaurantListItem,
  type RoomBooking,
  type TicketListItem,
  type TicketListQuery,
  type VendorListQuery,
} from '@zoauro/shared';
import type { AuthContext } from '../../../lib/authz';
import { parseBody } from '../../../lib/errors';
import { datedFilename, pagedListSource, rupees, type ExportSource } from '../../../lib/exports';

// D149: one export source per list, each reading through the module's own list service (its zone scope, filters, sort
// and masking, D26). A source exists only where the list service exists; payments, refunds and payouts join when their
// list services land (audit logs keep their own route, AU-8).

type Page<R> = Promise<{ data: readonly R[]; meta: { total: number } }>;

export interface ListServices {
  vendors?: {
    list(ctx: AuthContext, module: 'restaurants' | 'homemakers', q: VendorListQuery): Page<unknown>;
  };
  menu?: { list(ctx: AuthContext, q: MenuItemListQuery): Page<MenuItemListItem> };
  partners?: { list(ctx: AuthContext, q: PartnerListQuery): Page<PartnerListItem> };
  hotels?: { list(ctx: AuthContext, q: HotelListQuery): Page<HotelListItem> };
  bookings?: {
    listBookings(ctx: AuthContext, q: BookingListQuery): Page<RoomBooking>;
    listDining(ctx: AuthContext, q: DiningListQuery): Page<DiningReservation>;
  };
  notifications?: { list(ctx: AuthContext, q: NotificationListQuery): Page<NotificationListItem> };
  support?: { list(ctx: AuthContext, q: TicketListQuery): Page<TicketListItem> };
  customers?: { list(ctx: AuthContext, q: CustomerListQuery): Page<CustomerListItem> };
  /** D182 F1 */
  offers?: { list(ctx: AuthContext, q: OfferListQuery): Page<Offer> };
}

const name = (r: { name: string } | null | undefined) => r?.name ?? '';
const list = (v: readonly string[]) => v.join('; ');

const vendorColumns = [
  { header: 'Name', value: (v: RestaurantListItem | HomemakerListItem) => v.name },
  { header: 'Zone', value: (v: RestaurantListItem | HomemakerListItem) => name(v.zone) },
  { header: 'Area', value: (v: RestaurantListItem | HomemakerListItem) => v.area },
  { header: 'Phone', value: (v: RestaurantListItem | HomemakerListItem) => v.phone },
  { header: 'Email', value: (v: RestaurantListItem | HomemakerListItem) => v.email },
  { header: 'Status', value: (v: RestaurantListItem | HomemakerListItem) => v.status },
  {
    header: 'Verification',
    value: (v: RestaurantListItem | HomemakerListItem) => v.verificationStatus,
  },
  { header: 'Open now', value: (v: RestaurantListItem | HomemakerListItem) => v.isOpen },
  { header: 'Source', value: (v: RestaurantListItem | HomemakerListItem) => v.source },
  { header: 'Created at (UTC)', value: (v: RestaurantListItem | HomemakerListItem) => v.createdAt },
  { header: 'Id', value: (v: RestaurantListItem | HomemakerListItem) => v.id },
] as const;

export function listExportSources(s: ListServices): ExportSource[] {
  const out: ExportSource[] = [];
  const { vendors, menu, partners, hotels, bookings, notifications, support, customers, offers } =
    s;

  if (vendors) {
    out.push(
      pagedListSource<VendorListQuery, RestaurantListItem>({
        module: 'restaurants',
        viewKey: 'restaurants:view',
        audit: { module: 'restaurants', action: 'restaurant.exported' },
        parse: (raw) => parseBody(vendorListQuerySchema, raw),
        list: (ctx, q) => vendors.list(ctx, 'restaurants', q) as Page<RestaurantListItem>,
        columns: () => [
          ...vendorColumns,
          { header: 'Kind', value: (v) => v.kind },
          { header: 'Owner', value: (v) => v.ownerName },
          { header: 'Cuisines', value: (v) => list(v.cuisineTags) },
        ],
        filename: datedFilename('restaurants'),
      }),
      pagedListSource<VendorListQuery, HomemakerListItem>({
        module: 'homemakers',
        viewKey: 'homemakers:view',
        audit: { module: 'homemakers', action: 'homemaker.exported' },
        parse: (raw) => parseBody(vendorListQuerySchema, raw),
        list: (ctx, q) => vendors.list(ctx, 'homemakers', q) as Page<HomemakerListItem>,
        columns: () => [
          ...vendorColumns,
          { header: 'Food category', value: (v) => v.foodCategory },
          { header: 'Specialities', value: (v) => list(v.specialityTags) },
          { header: 'Available', value: (v) => v.isAvailable },
          { header: 'Daily capacity', value: (v) => v.dailyCapacity },
        ],
        filename: datedFilename('home-food'),
      }),
    );
  }

  if (menu) {
    out.push(
      pagedListSource<MenuItemListQuery, MenuItemListItem>({
        module: 'menu',
        viewKey: 'menu:view',
        audit: { module: 'menu', action: 'menu_item.exported' },
        parse: (raw) => parseBody(menuItemListQuerySchema, raw),
        list: (ctx, q) => menu.list(ctx, q),
        columns: () => [
          { header: 'Item', value: (m) => m.name },
          { header: 'Vendor', value: (m) => m.vendor.name },
          { header: 'Zone', value: (m) => m.zone.name },
          { header: 'Category', value: (m) => m.category.name },
          { header: 'Price (INR)', value: (m) => rupees(m.price) },
          { header: 'Price (paise)', value: (m) => m.price },
          { header: 'Stock', value: (m) => m.stock },
          { header: 'Availability', value: (m) => m.availability },
          { header: 'Vendor switch', value: (m) => m.isAvailable },
          { header: 'Admin disabled', value: (m) => m.adminDisabled },
          { header: 'Featured', value: (m) => m.isFeatured },
          { header: 'Dietary', value: (m) => m.dietary },
          { header: 'Pending change', value: (m) => m.hasPendingChange },
          { header: 'Id', value: (m) => m.id },
        ],
        filename: datedFilename('menu-items'),
      }),
    );
  }

  if (partners) {
    out.push(
      pagedListSource<PartnerListQuery, PartnerListItem>({
        module: 'delivery',
        viewKey: 'delivery:view',
        audit: { module: 'delivery', action: 'partner.exported' },
        parse: (raw) => parseBody(partnerListQuerySchema, raw),
        list: (ctx, q) => partners.list(ctx, q),
        columns: () => [
          { header: 'Name', value: (p) => p.name },
          { header: 'Zone', value: (p) => name(p.zone) },
          { header: 'Phone', value: (p) => p.phone },
          { header: 'Email', value: (p) => p.email },
          { header: 'Vehicle', value: (p) => p.vehicleType },
          { header: 'Vehicle no', value: (p) => p.vehicleNo },
          { header: 'Status', value: (p) => p.status },
          { header: 'Verification', value: (p) => p.verificationStatus },
          { header: 'Online', value: (p) => p.isOnline },
          { header: 'Current orders', value: (p) => p.currentOrders },
          { header: 'Cash in hand (INR)', value: (p) => rupees(p.cashInHand) },
          { header: 'Deliveries', value: (p) => p.deliveriesCount },
          { header: 'Rating', value: (p) => p.ratingAvg },
          { header: 'Id', value: (p) => p.id },
        ],
        filename: datedFilename('delivery-partners'),
      }),
    );
  }

  if (hotels) {
    out.push(
      pagedListSource<HotelListQuery, HotelListItem>({
        module: 'hotels',
        viewKey: 'hotels:view',
        audit: { module: 'hotels', action: 'hotel.exported' },
        parse: (raw) => parseBody(hotelListQuerySchema, raw),
        list: (ctx, q) => hotels.list(ctx, q),
        columns: () => [
          { header: 'Hotel', value: (h) => h.name },
          { header: 'Zone', value: (h) => h.zone.name },
          { header: 'Owner', value: (h) => h.ownerName },
          { header: 'Phone', value: (h) => h.phone },
          { header: 'Email', value: (h) => h.email },
          { header: 'Area', value: (h) => h.area },
          { header: 'Rooms', value: (h) => h.totalRooms },
          { header: 'Occupied today', value: (h) => h.occupiedRooms },
          { header: 'Status', value: (h) => h.status },
          { header: 'Verification', value: (h) => h.verificationStatus },
          { header: 'Id', value: (h) => h.id },
        ],
        filename: datedFilename('hotels'),
      }),
    );
  }

  if (bookings) {
    out.push(
      pagedListSource<BookingListQuery, RoomBooking>({
        module: 'bookings',
        viewKey: 'bookings:view',
        audit: { module: 'hotels', action: 'room_booking.exported' },
        parse: (raw) => parseBody(bookingListQuerySchema, raw),
        list: (ctx, q) => bookings.listBookings(ctx, q),
        columns: () => [
          { header: 'Hotel', value: (b) => b.hotel.name },
          { header: 'Zone', value: (b) => b.zone.name },
          { header: 'Guest', value: (b) => b.customerName },
          { header: 'Guest phone', value: (b) => b.customerPhone },
          { header: 'Room type', value: (b) => b.roomType },
          { header: 'Check-in', value: (b) => b.checkIn },
          { header: 'Check-out', value: (b) => b.checkOut },
          { header: 'Guests', value: (b) => b.guests },
          { header: 'Status', value: (b) => b.status },
          { header: 'Payment', value: (b) => b.paymentStatus },
          { header: 'Amount (INR)', value: (b) => rupees(b.amount) },
          { header: 'Id', value: (b) => b.id },
        ],
        filename: datedFilename('room-bookings'),
      }),
      pagedListSource<DiningListQuery, DiningReservation>({
        module: 'dining',
        viewKey: 'dining:view',
        audit: { module: 'hotels', action: 'dining_reservation.exported' },
        parse: (raw) => parseBody(diningListQuerySchema, raw),
        list: (ctx, q) => bookings.listDining(ctx, q),
        columns: () => [
          { header: 'Venue', value: (d) => name(d.hotel) || name(d.restaurant) },
          { header: 'Zone', value: (d) => d.zone.name },
          { header: 'Guest', value: (d) => d.customerName },
          { header: 'Guest phone', value: (d) => d.customerPhone },
          { header: 'Date', value: (d) => d.reservedDate },
          { header: 'Time', value: (d) => d.reservedTime },
          { header: 'Guests', value: (d) => d.guests },
          { header: 'Table area', value: (d) => d.tableArea },
          { header: 'Status', value: (d) => d.status },
          { header: 'Payment', value: (d) => d.paymentStatus },
          { header: 'Amount (INR)', value: (d) => (d.amount === null ? null : rupees(d.amount)) },
          { header: 'Id', value: (d) => d.id },
        ],
        filename: datedFilename('dining-reservations'),
      }),
    );
  }

  if (offers) {
    out.push(
      pagedListSource<OfferListQuery, Offer>({
        module: 'offers',
        viewKey: 'offers:view',
        audit: { module: 'offers', action: 'offer.exported' },
        parse: (raw) => parseBody(offerListQuerySchema, raw),
        list: (ctx, q) => offers.list(ctx, q),
        columns: () => [
          { header: 'Title', value: (o) => o.title },
          { header: 'Code', value: (o) => o.code ?? 'Automatic' },
          { header: 'Scope', value: (o) => o.scope },
          {
            header: 'Zones',
            value: (o) => (o.scope === 'PLATFORM' ? 'All zones' : list(o.zones.map((z) => z.name))),
          },
          { header: 'Vendor', value: (o) => name(o.vendor) },
          { header: 'Discount', value: (o) => offerValueText(o) },
          { header: 'Min order (Rs)', value: (o) => rupees(o.minOrderPaise) },
          { header: 'Funded by', value: (o) => o.fundedBy },
          { header: 'Vendor share %', value: (o) => o.vendorSharePct },
          { header: 'Status', value: (o) => o.status },
          { header: 'Valid from (UTC)', value: (o) => o.validFrom },
          { header: 'Valid to (UTC)', value: (o) => o.validTo },
          { header: 'Uses', value: (o) => o.usedCount },
          { header: 'Total uses limit', value: (o) => o.usageLimit },
          { header: 'Spent (Rs)', value: (o) => rupees(o.spentPaise) },
          {
            header: 'Budget (Rs)',
            value: (o) => (o.budgetPaise === null ? null : rupees(o.budgetPaise)),
          },
          { header: 'Source', value: (o) => o.source },
          { header: 'Requested by', value: (o) => name(o.requestedBy) },
          { header: 'Decided by', value: (o) => name(o.decidedBy) },
          { header: 'Id', value: (o) => o.id },
        ],
        filename: datedFilename('offers'),
      }),
    );
  }

  if (notifications) {
    out.push(
      pagedListSource<NotificationListQuery, NotificationListItem>({
        module: 'notifications',
        viewKey: 'notifications:view',
        audit: { module: 'notifications', action: 'notification.exported' },
        parse: (raw) => parseBody(notificationListQuerySchema, raw),
        list: (ctx, q) => notifications.list(ctx, q),
        columns: () => [
          { header: 'Title', value: (n) => n.title },
          { header: 'Kind', value: (n) => n.kind },
          { header: 'Status', value: (n) => n.status },
          { header: 'Audience', value: (n) => n.audience },
          {
            header: 'Zones',
            value: (n) => (n.zones.length === 0 ? 'All zones' : list(n.zones.map((z) => z.name))),
          },
          { header: 'Channels', value: (n) => list(n.channels) },
          { header: 'Scheduled at (UTC)', value: (n) => n.scheduledAt },
          { header: 'Sent at (UTC)', value: (n) => n.sentAt },
          { header: 'Requested by', value: (n) => name(n.requestedBy) },
          { header: 'Decided by', value: (n) => name(n.decidedBy) },
          { header: 'Id', value: (n) => n.id },
        ],
        filename: datedFilename('notifications'),
      }),
    );
  }

  if (support) {
    out.push(
      pagedListSource<TicketListQuery, TicketListItem>({
        module: 'support',
        viewKey: 'support:view',
        audit: { module: 'support', action: 'ticket.exported' },
        parse: (raw) => parseBody(ticketListQuerySchema, raw),
        list: (ctx, q) => support.list(ctx, q),
        columns: (l) => [
          { header: 'Ticket no', value: (t) => t.ticketNo },
          { header: 'Zone', value: (t) => l.zoneName(t.zoneId) },
          { header: 'Status', value: (t) => t.status },
          { header: 'Priority', value: (t) => t.priority },
          { header: 'Category', value: (t) => t.category },
          { header: 'Subject', value: (t) => t.subject },
          { header: 'Customer', value: (t) => t.customerName },
          { header: 'Customer phone', value: (t) => t.customerPhoneMasked },
          { header: 'Assignee', value: (t) => name(t.assignee) },
          { header: 'Resolution due (UTC)', value: (t) => t.resolutionDueAt },
          { header: 'Breached', value: (t) => t.breached },
          { header: 'Created at (UTC)', value: (t) => t.createdAt },
          { header: 'Order id', value: (t) => t.orderId },
          { header: 'Id', value: (t) => t.id },
        ],
        filename: datedFilename('support-tickets'),
      }),
    );
  }
  if (customers) {
    out.push(
      pagedListSource<CustomerListQuery, CustomerListItem>({
        module: 'customers',
        viewKey: 'customers:view',
        audit: { module: 'customers', action: 'customer.exported' },
        parse: (raw) => parseBody(customerListQuerySchema, raw),
        list: (ctx, q) => customers.list(ctx, q),
        columns: () => [
          { header: 'Name', value: (c) => c.name },
          { header: 'Phone', value: (c) => c.phone },
          { header: 'Email', value: (c) => c.email },
          { header: 'Status', value: (c) => c.status },
          { header: 'Source', value: (c) => c.source },
          { header: 'Zones', value: (c) => list(c.zones.map((z) => z.name)) },
          { header: 'Orders', value: (c) => c.orderCount },
          { header: 'Total spent (INR)', value: (c) => rupees(c.totalSpentPaise) },
          { header: 'Last order (UTC)', value: (c) => c.lastOrderAt },
          { header: 'Created at (UTC)', value: (c) => c.createdAt },
          { header: 'Id', value: (c) => c.id },
        ],
        filename: datedFilename('customers'),
      }),
    );
  }
  return out;
}
