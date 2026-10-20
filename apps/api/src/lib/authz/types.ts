import type { PermissionKey, Role } from '@zoauro/shared';

// AuthContext (doc 14 section 4). Built on every request from the access tables; never stored in the session.

export interface ZoneLimits {
  /** integer paise; 0 = every refund needs approval */
  perRefund: number;
  dailyRefund: number;
  canReveal: boolean;
  canExport: boolean;
}

export interface AuthContext {
  readonly userId: string;
  readonly role: Role;
  readonly isSuperAdmin: boolean;
  /** zones with an active assignment (empty for Super Admin, who is global) */
  readonly assignedZoneIds: readonly string[];
  /** per zone: profile + grants - denies (deny wins), restricted to what a Zonal Admin may ever hold */
  readonly permissionsByZone: ReadonlyMap<string, ReadonlySet<PermissionKey>>;
  readonly limitsByZone: ReadonlyMap<string, ZoneLimits>;
  /** `?zoneId=` from the request, validated against the assignment; 'ALL' when omitted */
  readonly requestedZoneIds: readonly string[] | 'ALL';
}

/** Which zones a query may touch. `ALL` = no zone filter (Super Admin who asked for no particular zone). */
export type ZoneScope =
  { readonly kind: 'ALL' } | { readonly kind: 'ZONES'; readonly zoneIds: readonly string[] };
