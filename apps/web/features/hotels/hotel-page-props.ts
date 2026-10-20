import type { MeResponse, PermissionKey } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';
import type { HotelView } from './labels';

// What the hotel pages show a member, from /me (server side): their zones, which lists, which buttons. A convenience
// only: the API checks every request against the member's permissions in the hotel's zone (hotels, bookings, dining;
// commission edit per member and zone behind the Control Panel switch, D155).

export interface HotelPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view at least one of the three lists */
  myZones: ScopeZone[];
  views: HotelView[];
  can: {
    addHotel: boolean;
    editHotel: boolean;
    hotelStatus: boolean;
    deleteHotel: boolean;
    addBooking: boolean;
    bookingStatus: boolean;
    addDining: boolean;
    diningStatus: boolean;
    commission: boolean;
  };
}

export function hotelPageProps(me: MeResponse): HotelPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      myZones: [],
      views: ['hotels', 'bookings', 'dining'],
      can: {
        addHotel: true,
        editHotel: true,
        hotelStatus: true,
        deleteHotel: true,
        addBooking: true,
        bookingStatus: true,
        addDining: true,
        diningStatus: true,
        commission: true,
      },
    };
  const zones = me.permissions.zones;
  const holds = (key: PermissionKey) => zones.some((z) => z.permissions.includes(key));
  const views = (['hotels', 'bookings', 'dining'] as const).filter((m) => holds(`${m}:view`));
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => views.some((m) => z.permissions.includes(`${m}:view` as const)))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    views,
    can: {
      addHotel: holds('hotels:add'),
      editHotel: holds('hotels:edit'),
      hotelStatus: holds('hotels:status'),
      deleteHotel: holds('hotels:delete'),
      addBooking: holds('bookings:add'),
      bookingStatus: holds('bookings:status'),
      addDining: holds('dining:add'),
      diningStatus: holds('dining:status'),
      commission: holds('commission:edit'),
    },
  };
}
