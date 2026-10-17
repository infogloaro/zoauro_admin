import type { DiningReservation, Hotel, RoomBooking } from '@prisma/client';

/** Zone reference embedded on every hotel row (doc 20 zone chips, doc 36). */
export interface ZoneRef {
  id: string;
  name: string;
  city: string;
}

export interface HotelOwnerRef {
  id: string;
  name: string;
}

export type HotelRowWithZone = Hotel & { zone: ZoneRef };
export type RoomBookingRowWithZone = RoomBooking & { zone: ZoneRef; hotel: HotelOwnerRef };
export type DiningRowWithVenue = DiningReservation & {
  zone: ZoneRef;
  hotel: HotelOwnerRef | null;
  restaurant: HotelOwnerRef | null;
};
