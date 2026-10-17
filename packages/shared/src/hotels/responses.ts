import { z } from 'zod';
import { pageMetaSchema } from '../pagination';
import { VENDOR_STATUSES, VERIFICATION_STATUSES } from '../vendors/schemas';
import { BOOKING_PAYMENT_STATUSES, BOOKING_STATUSES, DINING_STATUSES } from './schemas';

// Hotel Room Booking responses (D118, D26), shared with the hotel screens and the OpenAPI document. Hotel and customer
// phones and emails are masked (D26).

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const hotelZoneRefSchema = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
const ref = z.object({ id: z.uuid(), name: z.string() });

/** A row of GET /hotels. */
export const hotelListItemSchema = z.object({
  id: z.uuid(),
  zone: hotelZoneRefSchema,
  name: z.string(),
  ownerName: z.string(),
  /** masked (D26) */
  phone: z.string(),
  /** masked (D26) */
  email: z.string().nullable(),
  area: z.string().nullable(),
  totalRooms: z.number().int(),
  /** rooms held by a blocking booking that covers today */
  occupiedRooms: count,
  status: z.enum(VENDOR_STATUSES),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  createdAt: iso,
  updatedAt: iso,
});
export type HotelListItem = z.infer<typeof hotelListItemSchema>;

export const hotelCountsSchema = z.object({
  total: count,
  active: count,
  pendingVerification: count,
  suspended: count,
});
export type HotelCounts = z.infer<typeof hotelCountsSchema>;

export const hotelListResponseSchema = z.object({
  data: z.array(hotelListItemSchema),
  meta: pageMetaSchema.extend({ counts: hotelCountsSchema }),
});
export type HotelListResponse = z.infer<typeof hotelListResponseSchema>;

/** GET /hotels/{id} and every hotel write. */
export const hotelDetailSchema = hotelListItemSchema.extend({
  address: z.string(),
  /** Decimal(5,2) as a number */
  commissionPct: z.number(),
  gstNo: z.string().nullable(),
  verificationNote: z.string().nullable(),
  verifiedAt: iso.nullable(),
  verifiedBy: ref.nullable(),
});
export type HotelDetail = z.infer<typeof hotelDetailSchema>;

/** A room booking (list row, detail and write). */
export const roomBookingSchema = z.object({
  id: z.uuid(),
  zone: hotelZoneRefSchema,
  hotel: ref,
  customerName: z.string(),
  /** masked (D26) */
  customerPhone: z.string(),
  roomType: z.string(),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  guests: z.number().int(),
  status: z.enum(BOOKING_STATUSES),
  /** informational (D127 (3)): a cancel never refunds by itself */
  paymentStatus: z.enum(BOOKING_PAYMENT_STATUSES),
  amount: z.number().int(),
  note: z.string().nullable(),
  version: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
});
export type RoomBooking = z.infer<typeof roomBookingSchema>;

export const bookingListResponseSchema = z.object({
  data: z.array(roomBookingSchema),
  meta: pageMetaSchema,
});
export type BookingListResponse = z.infer<typeof bookingListResponseSchema>;

/** A dining reservation (list row, detail and write); exactly one of hotel / restaurant. */
export const diningReservationSchema = z.object({
  id: z.uuid(),
  zone: hotelZoneRefSchema,
  hotel: ref.nullable(),
  restaurant: ref.nullable(),
  customerName: z.string(),
  /** masked (D26) */
  customerPhone: z.string(),
  reservedDate: z.iso.date(),
  reservedTime: z.string(),
  guests: z.number().int(),
  tableArea: z.string().nullable(),
  status: z.enum(DINING_STATUSES),
  paymentStatus: z.enum(BOOKING_PAYMENT_STATUSES),
  amount: z.number().int().nullable(),
  note: z.string().nullable(),
  version: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
});
export type DiningReservation = z.infer<typeof diningReservationSchema>;

export const diningListResponseSchema = z.object({
  data: z.array(diningReservationSchema),
  meta: pageMetaSchema,
});
export type DiningListResponse = z.infer<typeof diningListResponseSchema>;
