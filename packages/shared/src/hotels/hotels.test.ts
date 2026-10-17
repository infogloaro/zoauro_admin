import { describe, expect, it } from 'vitest';
import {
  bookingCreateSchema,
  bookingListQuerySchema,
  diningCreateSchema,
  hotelCreateSchema,
  hotelUpdateSchema,
  hotelVerificationSchema,
} from './schemas';

const ZONE = '0192f1d2-0000-7000-8000-000000000001';
const HOTEL = '0192f1d2-0000-7000-8000-000000000002';
const hotel = {
  zoneId: ZONE,
  name: 'Lake View Inn',
  ownerName: 'Ravi',
  phone: '98765 43210',
  address: '1 Lake Road',
  totalRooms: 12,
};
const booking = {
  customerName: 'Asha',
  customerPhone: '+91 91234 56789',
  roomType: 'Deluxe',
  checkIn: '2026-11-01',
  checkOut: '2026-11-03',
  guests: 2,
  amount: 450000,
};
const dining = {
  customerName: 'Asha',
  customerPhone: '9123456789',
  reservedDate: '2026-11-01',
  reservedTime: '19:30',
  guests: 4,
};

describe('hotels contract', () => {
  it('normalises the phone, needs a room, rejects unknown fields and bad commission', () => {
    expect(hotelCreateSchema.parse(hotel).phone).toBe('+919876543210');
    expect(hotelCreateSchema.safeParse({ ...hotel, totalRooms: 0 }).success).toBe(false);
    expect(hotelCreateSchema.safeParse({ ...hotel, status: 'ACTIVE' }).success).toBe(false);
    expect(hotelCreateSchema.safeParse({ ...hotel, commissionPct: 12.555 }).success).toBe(false);
    expect(hotelUpdateSchema.safeParse({}).success).toBe(false);
    expect(hotelUpdateSchema.safeParse({ zoneId: ZONE }).success).toBe(false);
  });

  it('a rejection needs a note', () => {
    expect(hotelVerificationSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(hotelVerificationSchema.safeParse({ decision: 'VERIFIED' }).success).toBe(true);
  });

  it('a booking checks out after it checks in and defaults the payment to PENDING', () => {
    expect(bookingCreateSchema.parse(booking).paymentStatus).toBe('PENDING');
    expect(bookingCreateSchema.safeParse({ ...booking, checkOut: '2026-11-01' }).success).toBe(
      false,
    );
    expect(bookingCreateSchema.safeParse({ ...booking, guests: 0 }).success).toBe(false);
    expect(bookingCreateSchema.safeParse({ ...booking, amount: 10.5 }).success).toBe(false);
    expect(
      bookingListQuerySchema.safeParse({ checkInFrom: '2026-11-02', checkInTo: '2026-11-01' })
        .success,
    ).toBe(false);
  });

  it('a dining reservation names exactly one venue', () => {
    expect(diningCreateSchema.safeParse(dining).success).toBe(false);
    expect(diningCreateSchema.safeParse({ ...dining, hotelId: HOTEL }).success).toBe(true);
    expect(
      diningCreateSchema.safeParse({ ...dining, hotelId: HOTEL, restaurantId: HOTEL }).success,
    ).toBe(false);
    expect(
      diningCreateSchema.safeParse({ ...dining, hotelId: HOTEL, reservedTime: '7pm' }).success,
    ).toBe(false);
  });
});
