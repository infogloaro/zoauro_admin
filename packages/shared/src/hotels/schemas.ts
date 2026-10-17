import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';
import {
  commissionPctSchema,
  VENDOR_ADDRESS,
  VENDOR_NAME,
  VENDOR_STATUS_TARGETS,
  VENDOR_STATUSES,
  VERIFICATION_DECISIONS,
  VERIFICATION_NOTE,
  VERIFICATION_STATUSES,
  vendorPhoneSchema,
} from '../vendors/schemas';

// Hotel Room Booking (D91, D118, D127) request schemas: hotels, room bookings and dining reservations, shared with the
// hotel screens and the OpenAPI document. Ported from Chittra Priya's branch, rebuilt on the core conventions. Hotels
// reuse the vendor lifecycle (status + verification, doc 10 section 4). Booking dates are calendar days (check-in
// inclusive, check-out exclusive). Money is integer paise; booking payment status is informational (D127 (3)).

export const BOOKING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Targets of POST /hotels/bookings/{bookingId}/status. */
export const BOOKING_STATUS_TARGETS = [
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
] as const;
export type BookingStatusTarget = (typeof BOOKING_STATUS_TARGETS)[number];
/** Statuses that hold a room for the stay (capacity check, D127 (7)). */
export const BOOKING_BLOCKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN'] as const;

export const DINING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type DiningStatus = (typeof DINING_STATUSES)[number];
export const DINING_STATUS_TARGETS = ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type DiningStatusTarget = (typeof DINING_STATUS_TARGETS)[number];

/** Database enum BookingPaymentStatus: separate from the order PaymentStatus. */
export const BOOKING_PAYMENT_STATUSES = ['PENDING', 'PAID', 'REFUNDED', 'FAILED'] as const;
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUSES)[number];

export const HOTEL_ROOMS_MAX = 10_000;
export const BOOKING_GUESTS_MAX = 50;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max);
const email = z.email('Enter a valid email').max(254);
const amount = z.number().int().min(0).max(2_147_483_647);
const note = optionalText(300);
const guests = z.number().int().min(1, 'At least 1 guest').max(BOOKING_GUESTS_MAX);
const day = z.iso.date('Use a date like 2026-10-15');
const hourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 19:30');
const totalRooms = z.number().int().min(1, 'A hotel needs at least one room').max(HOTEL_ROOMS_MAX);
const gstNo = optionalText(20);
const notEmpty = { message: 'Provide at least one field to update' };

/** `?zoneId=` is repeatable (doc 09); a single value arrives as a string. */
const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);
const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

// ---- hotels -------------------------------------------------------------------------------------------------------

/** POST /hotels: needs `zoneId` (doc 09); commission is Super Admin only (403 for a Zonal Admin). */
export const hotelCreateSchema = z
  .object({
    zoneId: z.uuid('Choose a zone'),
    name: text(VENDOR_NAME.min, VENDOR_NAME.max),
    ownerName: text(2, 80),
    phone: vendorPhoneSchema,
    email: email.optional(),
    address: text(VENDOR_ADDRESS.min, VENDOR_ADDRESS.max),
    area: optionalText(80).optional(),
    totalRooms,
    commissionPct: commissionPctSchema.optional(),
    gstNo: gstNo.optional(),
  })
  .strict();
export type HotelCreateInput = z.infer<typeof hotelCreateSchema>;

/** PATCH /hotels/{id}: the zone is fixed; status and verification have their own routes. */
export const hotelUpdateSchema = z
  .object({
    name: text(VENDOR_NAME.min, VENDOR_NAME.max).optional(),
    ownerName: text(2, 80).optional(),
    phone: vendorPhoneSchema.optional(),
    email: email.nullable().optional(),
    address: text(VENDOR_ADDRESS.min, VENDOR_ADDRESS.max).optional(),
    area: optionalText(80).nullable().optional(),
    totalRooms: totalRooms.optional(),
    commissionPct: commissionPctSchema.optional(),
    gstNo: gstNo.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, notEmpty);
export type HotelUpdateInput = z.infer<typeof hotelUpdateSchema>;

/** POST /hotels/{id}/status (vendor lifecycle, doc 10 section 4). */
export const hotelStatusSchema = z
  .object({ status: z.enum(VENDOR_STATUS_TARGETS), reason: note.optional() })
  .strict();
export type HotelStatusInput = z.infer<typeof hotelStatusSchema>;

/** POST /hotels/{id}/verification: a reject needs a note. */
export const hotelVerificationSchema = z
  .object({
    decision: z.enum(VERIFICATION_DECISIONS),
    note: text(VERIFICATION_NOTE.min, VERIFICATION_NOTE.max).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'VERIFIED' || v.note !== undefined, {
    message: 'A note is required when rejecting',
    path: ['note'],
  });
export type HotelVerificationInput = z.infer<typeof hotelVerificationSchema>;

export const hotelIdParamsSchema = z.object({ id: z.uuid() });
export const bookingIdParamsSchema = z.object({ bookingId: z.uuid() });
export const diningIdParamsSchema = z.object({ diningId: z.uuid() });

export const HOTEL_SORT_FIELDS = ['createdAt', 'name', 'area', 'totalRooms'] as const;

/** GET /hotels: `q` matches name, owner or area. */
export const hotelListQuerySchema = z.object({
  ...page,
  sort: sortSchema(HOTEL_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  q: optionalText(100).optional(),
  zoneId: zoneIdsParam,
  status: z.enum(VENDOR_STATUSES).optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  area: optionalText(80).optional(),
});
export type HotelListQuery = z.infer<typeof hotelListQuerySchema>;

// ---- room bookings ------------------------------------------------------------------------------------------------

/** POST /hotels/{id}/bookings: 409 NO_ROOMS_AVAILABLE when the stay overlaps total_rooms blocking bookings. */
export const bookingCreateSchema = z
  .object({
    customerName: text(2, 80),
    customerPhone: vendorPhoneSchema,
    roomType: text(1, 40),
    checkIn: day,
    checkOut: day,
    guests,
    amount,
    paymentStatus: z.enum(BOOKING_PAYMENT_STATUSES).default('PENDING'),
    note: note.optional(),
  })
  .strict()
  .refine((v) => v.checkOut > v.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  });
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

/** POST /hotels/bookings/{bookingId}/status: `version` is the booking's (optimistic lock, 409 STALE_VERSION). */
export const bookingStatusSchema = z
  .object({
    status: z.enum(BOOKING_STATUS_TARGETS),
    version: z.number().int().min(1),
    note: note.optional(),
  })
  .strict();
export type BookingStatusInput = z.infer<typeof bookingStatusSchema>;

export const BOOKING_SORT_FIELDS = ['checkIn', 'createdAt'] as const;

/** GET /hotels/bookings and GET /hotels/{id}/bookings. `q` matches the customer name. */
export const bookingListQuerySchema = z
  .object({
    ...page,
    sort: sortSchema(BOOKING_SORT_FIELDS, { field: 'checkIn', direction: 'desc' }),
    q: optionalText(100).optional(),
    zoneId: zoneIdsParam,
    hotelId: z.uuid().optional(),
    status: z.enum(BOOKING_STATUSES).optional(),
    paymentStatus: z.enum(BOOKING_PAYMENT_STATUSES).optional(),
    checkInFrom: day.optional(),
    checkInTo: day.optional(),
  })
  .refine((v) => !v.checkInFrom || !v.checkInTo || v.checkInFrom <= v.checkInTo, {
    message: 'checkInFrom must be before checkInTo',
    path: ['checkInFrom'],
  });
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

// ---- dining reservations ------------------------------------------------------------------------------------------

/** POST /hotels/dining: exactly one venue, a hotel or a restaurant; the zone is the venue's. */
export const diningCreateSchema = z
  .object({
    hotelId: z.uuid().optional(),
    restaurantId: z.uuid().optional(),
    customerName: text(2, 80),
    customerPhone: vendorPhoneSchema,
    reservedDate: day,
    reservedTime: hourMinute,
    guests,
    tableArea: optionalText(80).optional(),
    amount: amount.optional(),
    paymentStatus: z.enum(BOOKING_PAYMENT_STATUSES).default('PENDING'),
    note: note.optional(),
  })
  .strict()
  .refine((v) => (v.hotelId === undefined) !== (v.restaurantId === undefined), {
    message: 'Choose either the hotel or the restaurant',
    path: ['hotelId'],
  });
export type DiningCreateInput = z.infer<typeof diningCreateSchema>;

/** POST /hotels/dining/{diningId}/status. */
export const diningStatusSchema = z
  .object({
    status: z.enum(DINING_STATUS_TARGETS),
    version: z.number().int().min(1),
    note: note.optional(),
  })
  .strict();
export type DiningStatusInput = z.infer<typeof diningStatusSchema>;

export const DINING_SORT_FIELDS = ['reservedDate', 'createdAt'] as const;

export const diningListQuerySchema = z.object({
  ...page,
  sort: sortSchema(DINING_SORT_FIELDS, { field: 'reservedDate', direction: 'desc' }),
  q: optionalText(100).optional(),
  zoneId: zoneIdsParam,
  hotelId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
  status: z.enum(DINING_STATUSES).optional(),
  reservedDate: day.optional(),
});
export type DiningListQuery = z.infer<typeof diningListQuerySchema>;
