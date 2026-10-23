import { z } from 'zod';
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_TARGETS,
  DINING_STATUSES,
  PAYMENT_STATUSES,
  VERIFICATION_DECISIONS,
  VERIFICATION_STATUSES,
  VENDOR_STATUSES,
  VENDOR_STATUS_TARGETS,
} from './enums';
import { phoneSchema, vendorDocumentSchema } from './vendor';

/**
 * Hotel Room Booking contracts (task: match Hotel Room Booking Management,
 * incl. the Dining tab). Hotels reuse the vendor lifecycle (status +
 * verification, doc 10 §4); bookings and dining reservations are new tables.
 *
 * Booking dates are calendar days (check-in inclusive, check-out exclusive)
 * stored as UTC midnights. Money is integer paise. Inventory is guarded by
 * per-night capacity (D127(3)): a booking is refused when any night of its
 * stay would reach hotel.total_rooms (transaction + row lock → 409).
 * Status changes carry an optimistic `version` (D127(6)(7)).
 */

const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);
const addressSchema = z.string().trim().min(3, 'Address is required').max(240);
const areaSchema = z.string().trim().min(1).max(80).optional();
/** Commission 0–50 % (Super Admin only, doc 04). */
const commissionPctSchema = z
  .number()
  .min(0, 'Commission cannot be negative')
  .max(50, 'Commission cannot exceed 50%');
const gstNoSchema = z.string().trim().max(20).optional();
/** Money is integer paise (AGENTS.md). */
const amountSchema = z.number().int().min(0).max(2_147_483_647);
const noteSchema = z.string().trim().max(300).optional();
const guestsSchema = z.number().int().min(1, 'At least 1 guest').max(50);

/* ------------------------------------------------------------------ *
 * Hotels
 * ------------------------------------------------------------------ */

export const hotelCreateSchema = z.object({
  zoneId: z.uuid('Choose a zone'),
  name: nameSchema,
  ownerName: z.string().trim().min(2, 'Owner name is required').max(80),
  phone: phoneSchema,
  email: z.email('Enter a valid email').max(254).optional(),
  address: addressSchema,
  area: areaSchema,
  totalRooms: z.number().int().min(1, 'A hotel needs at least one room').max(10_000),
  commissionPct: commissionPctSchema.optional(),
  gstNo: gstNoSchema,
});

export type HotelCreateInput = z.infer<typeof hotelCreateSchema>;

/** PATCH /hotels/{id} — `zoneId` is not editable. Commission is Super Admin only. */
export const hotelUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    ownerName: z.string().trim().min(2).max(80).optional(),
    phone: phoneSchema.optional(),
    email: z.email('Enter a valid email').max(254).nullable().optional(),
    address: addressSchema.optional(),
    area: z.string().trim().max(80).nullable().optional(),
    totalRooms: z.number().int().min(1).max(10_000).optional(),
    commissionPct: commissionPctSchema.nullable().optional(),
    gstNo: z.string().trim().max(20).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export type HotelUpdateInput = z.infer<typeof hotelUpdateSchema>;

export const hotelStatusSchema = z.object({ status: z.enum(VENDOR_STATUS_TARGETS) });
export type HotelStatusInput = z.infer<typeof hotelStatusSchema>;

/** Reject needs a note (doc 10 §4 pattern). */
export const hotelVerificationSchema = z
  .object({
    decision: z.enum(VERIFICATION_DECISIONS),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => v.decision === 'VERIFIED' || v.note !== undefined, {
    error: 'A note is required when rejecting',
    path: ['note'],
  });
export type HotelVerificationInput = z.infer<typeof hotelVerificationSchema>;

export const HOTEL_SORT_FIELDS = ['createdAt', 'name', 'area'] as const;

export const listHotelsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  area: z.string().trim().min(1).max(80).optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt|name|area)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});

export type ListHotelsQuery = z.infer<typeof listHotelsQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09). */
export function requestedHotelZoneIds(query: ListHotelsQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

const hotelZoneRefSchema = z.object({ id: z.uuid(), name: z.string(), city: z.string() });

export const hotelSchema = z.object({
  kind: z.literal('hotel'),
  id: z.uuid(),
  zoneId: z.uuid(),
  zone: hotelZoneRefSchema,
  name: z.string(),
  ownerName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string(),
  area: z.string().nullable(),
  totalRooms: z.number().int(),
  commissionPct: z.number().nullable(),
  gstNo: z.string().nullable(),
  status: z.enum(VENDOR_STATUSES),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  verificationNote: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  verifiedBy: z.string().nullable(),
  /** Derived per list row (not stored): rooms with a stay covering today. */
  occupiedRooms: z.number().int(),
  /** Derived per list row (not stored): booking money in paise. */
  gross: z.number().int(),
  commission: z.number().int(),
  refunds: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Hotel = z.infer<typeof hotelSchema>;

export const hotelActivitySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actorName: z.string(),
  createdAt: z.string(),
});
export type HotelActivity = z.infer<typeof hotelActivitySchema>;

export const hotelDetailSchema = hotelSchema.extend({
  documents: z.array(vendorDocumentSchema),
  activity: z.array(hotelActivitySchema),
});
export type HotelDetail = z.infer<typeof hotelDetailSchema>;

/** GET /hotels/{id}/reveal (D26) — audited unmask of the hotel contact. */
export const hotelRevealSchema = z.object({
  phone: z.string(),
  email: z.string().nullable(),
});
export type HotelReveal = z.infer<typeof hotelRevealSchema>;

/* ------------------------------------------------------------------ *
 * Room bookings
 * ------------------------------------------------------------------ */

const stayDateSchema = z.iso.date('Use a date like 2026-10-15');

export const bookingCreateSchema = z
  .object({
    customerName: z.string().trim().min(2, 'Customer name is required').max(80),
    customerPhone: phoneSchema,
    roomType: z.string().trim().min(1, 'Room type is required').max(40),
    checkIn: stayDateSchema,
    checkOut: stayDateSchema,
    guests: guestsSchema,
    amount: amountSchema,
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    note: noteSchema,
  })
  .refine((v) => v.checkOut > v.checkIn, {
    error: 'Check-out must be after check-in',
    path: ['checkOut'],
  });

export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

/**
 * POST /bookings/{bookingId}/status — transitions in doc 10 style. `version`
 * is the optimistic lock (D127(6)(7)): it must match the stored row version.
 */
export const bookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUS_TARGETS),
  version: z.number().int().min(1, 'A version is required'),
  note: noteSchema,
});
export type BookingStatusInput = z.infer<typeof bookingStatusSchema>;

export const BOOKING_SORT_FIELDS = ['checkIn', 'createdAt'] as const;

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  hotelId: z.uuid().optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  checkInFrom: stayDateSchema.optional(),
  checkInTo: stayDateSchema.optional(),
  sort: z
    .string()
    .regex(/^-?(checkIn|createdAt)$/u, 'Unsupported sort field')
    .default('-checkIn'),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

export function requestedBookingZoneIds(query: ListBookingsQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

const hotelRefSchema = z.object({ id: z.uuid(), name: z.string() });
const restaurantRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const roomBookingSchema = z.object({
  kind: z.literal('booking'),
  id: z.uuid(),
  zoneId: z.uuid(),
  hotelId: z.uuid(),
  hotel: hotelRefSchema,
  customerName: z.string(),
  customerPhone: z.string(),
  roomType: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number().int(),
  status: z.enum(BOOKING_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  amount: z.number().int(),
  note: z.string().nullable(),
  /** Optimistic lock (D127(6)(7)); bumped by every status change. */
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoomBooking = z.infer<typeof roomBookingSchema>;

/* ------------------------------------------------------------------ *
 * Dining reservations
 * ------------------------------------------------------------------ */

const hourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24h time like 19:30');

export const diningCreateSchema = z
  .object({
    hotelId: z.uuid().optional(),
    restaurantId: z.uuid().optional(),
    customerName: z.string().trim().min(2, 'Customer name is required').max(80),
    customerPhone: phoneSchema,
    reservedDate: stayDateSchema,
    reservedTime: hourMinute,
    guests: guestsSchema,
    tableArea: z.string().trim().max(80).optional(),
    amount: amountSchema.optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    note: noteSchema,
  })
  .refine((v) => v.hotelId !== undefined || v.restaurantId !== undefined, {
    error: 'Choose the hotel or restaurant the reservation is for',
    path: ['hotelId'],
  });

export type DiningCreateInput = z.infer<typeof diningCreateSchema>;

/**
 * POST /dining/{diningId}/status — transitions in doc 10 style. `version`
 * is the optimistic lock (D127(6)(7)): it must match the stored row version.
 */
export const diningStatusSchema = z.object({
  status: z.enum(DINING_STATUSES),
  version: z.number().int().min(1, 'A version is required'),
  note: noteSchema,
});
export type DiningStatusInput = z.infer<typeof diningStatusSchema>;

export const DINING_SORT_FIELDS = ['reservedDate', 'createdAt'] as const;

export const listDiningQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  hotelId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
  status: z.enum(DINING_STATUSES).optional(),
  reservedDate: stayDateSchema.optional(),
  sort: z
    .string()
    .regex(/^-?(reservedDate|createdAt)$/u, 'Unsupported sort field')
    .default('-reservedDate'),
});

export type ListDiningQuery = z.infer<typeof listDiningQuerySchema>;

export function requestedDiningZoneIds(query: ListDiningQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

export const diningReservationSchema = z.object({
  kind: z.literal('dining'),
  id: z.uuid(),
  zoneId: z.uuid(),
  hotelId: z.uuid().nullable(),
  hotel: hotelRefSchema.nullable(),
  restaurantId: z.uuid().nullable(),
  restaurant: restaurantRefSchema.nullable(),
  customerName: z.string(),
  customerPhone: z.string(),
  reservedDate: z.string(),
  reservedTime: z.string(),
  guests: z.number().int(),
  tableArea: z.string().nullable(),
  status: z.enum(DINING_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  amount: z.number().int().nullable(),
  note: z.string().nullable(),
  /** Optimistic lock (D127(6)(7)); bumped by every status change. */
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DiningReservation = z.infer<typeof diningReservationSchema>;

/* ------------------------------------------------------------------ *
 * List responses + KPI metrics
 * ------------------------------------------------------------------ */

export const hotelCountsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  pendingVerification: z.number().int(),
  suspended: z.number().int(),
});
export type HotelCounts = z.infer<typeof hotelCountsSchema>;

export const hotelTrendPointSchema = z.object({ month: z.string(), value: z.number().int() });
export const hotelZoneOccupancySchema = z.object({
  zoneId: z.uuid(),
  name: z.string(),
  rooms: z.number().int(),
  occupied: z.number().int(),
  occupancyPct: z.number(),
});

/** Scope-wide, filter-independent numbers behind the KPI cards and charts. */
export const hotelMetricsSchema = z.object({
  bookings: z.number().int(),
  confirmed: z.number().int(),
  rooms: z.number().int(),
  occupied: z.number().int(),
  occupancyPct: z.number(),
  revenue: z.number().int(),
  commission: z.number().int(),
  refunds: z.number().int(),
  trend: z.array(hotelTrendPointSchema),
  zoneOccupancy: z.array(hotelZoneOccupancySchema),
});
export type HotelMetrics = z.infer<typeof hotelMetricsSchema>;

export const hotelFacetsSchema = z.object({
  areas: z.array(z.string()),
  zones: z.array(hotelZoneRefSchema),
});
export type HotelFacets = z.infer<typeof hotelFacetsSchema>;

export const listHotelsResponseSchema = z.object({
  data: z.array(hotelSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: hotelCountsSchema,
    metrics: hotelMetricsSchema,
    facets: hotelFacetsSchema,
  }),
});
export type ListHotelsResponse = z.infer<typeof listHotelsResponseSchema>;

export const bookingCountsSchema = z.object({ total: z.number().int(), pending: z.number().int() });

export const listBookingsResponseSchema = z.object({
  data: z.array(roomBookingSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: bookingCountsSchema,
  }),
});
export type ListBookingsResponse = z.infer<typeof listBookingsResponseSchema>;

export const diningCountsSchema = z.object({ total: z.number().int(), pending: z.number().int() });

export const listDiningResponseSchema = z.object({
  data: z.array(diningReservationSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: diningCountsSchema,
  }),
});
export type ListDiningResponse = z.infer<typeof listDiningResponseSchema>;

/* ------------------------------------------------------------------ *
 * Add/Edit forms — all-string values for react-hook-form (doc 22 style)
 * ------------------------------------------------------------------ */

export const hotelFormSchema = z.object({
  zoneId: z.string().min(1, 'Choose a zone'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  ownerName: z.string().trim().min(2, 'Owner name is required').max(80),
  phone: phoneSchema,
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  address: z.string().trim().min(3, 'Address is required').max(240),
  area: z.string().trim().max(80),
  totalRooms: z
    .string()
    .refine((v) => /^\d{1,4}$/.test(v) && Number(v) >= 1, 'Enter a room count of 1 or more'),
  commissionPct: z
    .string()
    .refine(
      (v) => v === '' || (/^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 50),
      'Enter a percentage between 0 and 50',
    ),
  gstNo: z.string().trim().max(20),
});

export type HotelFormValues = z.infer<typeof hotelFormSchema>;

export function hotelFormToPayload(form: HotelFormValues): HotelCreateInput & { zoneId: string } {
  return {
    zoneId: form.zoneId,
    name: form.name,
    ownerName: form.ownerName,
    phone: form.phone,
    email: form.email === '' ? undefined : form.email,
    address: form.address,
    area: form.area === '' ? undefined : form.area,
    totalRooms: Number(form.totalRooms),
    commissionPct: form.commissionPct === '' ? undefined : Number(form.commissionPct),
    gstNo: form.gstNo === '' ? undefined : form.gstNo,
  };
}

export function hotelFormToUpdate(
  form: HotelFormValues,
): Omit<HotelUpdateInput, 'name' | 'ownerName' | 'phone' | 'address' | 'totalRooms'> {
  return {
    email: form.email === '' ? null : form.email,
    area: form.area === '' ? null : form.area,
    commissionPct: form.commissionPct === '' ? null : Number(form.commissionPct),
    gstNo: form.gstNo === '' ? null : form.gstNo,
  };
}

export const bookingFormSchema = z
  .object({
    customerName: z.string().trim().min(2, 'Customer name is required').max(80),
    customerPhone: phoneSchema,
    roomType: z.string().trim().min(1, 'Room type is required').max(40),
    checkIn: z.string().min(1, 'Choose a check-in date'),
    checkOut: z.string().min(1, 'Choose a check-out date'),
    guests: z
      .string()
      .refine((v) => /^\d{1,2}$/.test(v) && Number(v) >= 1, 'Enter 1 or more guests'),
    amount: z
      .string()
      .refine((v) => /^\d{1,8}$/.test(v) && Number(v) >= 0, 'Enter the amount in rupees'),
    note: z.string().trim().max(300),
  })
  .refine((v) => v.checkIn === '' || v.checkOut === '' || v.checkOut > v.checkIn, {
    error: 'Check-out must be after check-in',
    path: ['checkOut'],
  });

export type BookingFormValues = z.infer<typeof bookingFormSchema>;

/** Empty-string optional becomes undefined; rupees → paise at the edge. */
export function bookingFormToPayload(form: BookingFormValues): BookingCreateInput {
  return {
    customerName: form.customerName,
    customerPhone: form.customerPhone,
    roomType: form.roomType,
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    guests: Number(form.guests),
    amount: Math.round(Number(form.amount) * 100),
    note: form.note.trim() === '' ? undefined : form.note.trim(),
  };
}

export const diningFormSchema = z.object({
  venueKind: z.enum(['hotel', 'restaurant']),
  venueId: z.string().min(1, 'Choose the hotel or restaurant'),
  customerName: z.string().trim().min(2, 'Customer name is required').max(80),
  customerPhone: phoneSchema,
  reservedDate: z.string().min(1, 'Choose a date'),
  reservedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24h time like 19:30'),
  guests: z.string().refine((v) => /^\d{1,2}$/.test(v) && Number(v) >= 1, 'Enter 1 or more guests'),
  tableArea: z.string().trim().max(80),
  amount: z
    .string()
    .refine(
      (v) => v === '' || (/^\d{1,8}$/.test(v) && Number(v) >= 0),
      'Enter the amount in rupees',
    ),
  note: z.string().trim().max(300),
});

export type DiningFormValues = z.infer<typeof diningFormSchema>;

export function diningFormToPayload(form: DiningFormValues): DiningCreateInput {
  return {
    ...(form.venueKind === 'hotel' ? { hotelId: form.venueId } : { restaurantId: form.venueId }),
    customerName: form.customerName,
    customerPhone: form.customerPhone,
    reservedDate: form.reservedDate,
    reservedTime: form.reservedTime,
    guests: Number(form.guests),
    tableArea: form.tableArea.trim() === '' ? undefined : form.tableArea.trim(),
    amount: form.amount === '' ? undefined : Math.round(Number(form.amount) * 100),
    note: form.note.trim() === '' ? undefined : form.note.trim(),
  };
}
