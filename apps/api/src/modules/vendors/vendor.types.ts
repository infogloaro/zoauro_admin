import type { Homemaker, Restaurant } from '@prisma/client';

/** Zone reference embedded on every vendor row (doc 20 zone chips, doc 36). */
export interface ZoneRef {
  id: string;
  name: string;
  city: string;
}

export type RestaurantRowWithZone = Restaurant & { zone: ZoneRef };
export type HomemakerRowWithZone = Homemaker & { zone: ZoneRef };
export type VendorRowWithZone = RestaurantRowWithZone | HomemakerRowWithZone;
