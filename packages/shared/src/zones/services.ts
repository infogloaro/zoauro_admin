import { z } from 'zod';

// D92 (owner, 2026-10-14): per-zone service switches, set by a Super Admin only. While a service is off in a zone, the
// admin screens hide it there and the API refuses new onboarding and new orders for it (ZONE_SERVICE_DISABLED). The
// apps are told later, through a contract change agreed with their teams (doc 32).

/** Database enum ZoneServiceKind. Adding a service = one entry here + a migration adding the enum value. */
export const ZONE_SERVICES = ['RESTAURANTS', 'HOME_FOOD', 'HOTEL_BOOKING'] as const;
export type ZoneServiceKind = (typeof ZONE_SERVICES)[number];

export const ZONE_SERVICE_LABELS: Readonly<Record<ZoneServiceKind, string>> = {
  RESTAURANTS: 'Restaurants',
  HOME_FOOD: 'Home Food',
  HOTEL_BOOKING: 'Hotel Booking',
};

/**
 * What applies to a zone with no stored switch (owner's choice): Restaurants and Home Food on; Hotel Booking off, as its
 * module is not designed yet (D91).
 */
export const ZONE_SERVICE_DEFAULTS: Readonly<Record<ZoneServiceKind, boolean>> = {
  RESTAURANTS: true,
  HOME_FOOD: true,
  HOTEL_BOOKING: false,
};

/** On/off per service, every service present: in zone lists, the zone detail and /me. */
export const zoneServiceFlagsSchema = z.object({
  RESTAURANTS: z.boolean(),
  HOME_FOOD: z.boolean(),
  HOTEL_BOOKING: z.boolean(),
});
export type ZoneServiceFlags = z.infer<typeof zoneServiceFlagsSchema>;

/** GET /zones/{id}/services: each service with where its value comes from. */
export const zoneServicesResponseSchema = z.object({
  zoneId: z.uuid(),
  services: z.array(
    z.object({
      service: z.enum(ZONE_SERVICES),
      label: z.string(),
      enabled: z.boolean(),
      /** true: nobody switched it yet, the default applies */
      isDefault: z.boolean(),
      updatedAt: z.iso.datetime().nullable(),
      updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    }),
  ),
});
export type ZoneServicesResponse = z.infer<typeof zoneServicesResponseSchema>;

/** PUT /zones/{id}/services (PASSWORD re-auth): the services to switch; the others keep their value. */
export const putZoneServicesSchema = z
  .object({ services: zoneServiceFlagsSchema.partial().strict() })
  .strict()
  .refine((v) => Object.keys(v.services).length > 0, {
    path: ['services'],
    message: 'name at least one service',
  });
export type PutZoneServicesInput = z.infer<typeof putZoneServicesSchema>;

/** Every service's on/off for one zone: the stored switches, the defaults for the rest. */
export function zoneServiceFlags(
  stored: readonly { service: ZoneServiceKind; enabled: boolean }[],
): ZoneServiceFlags {
  const flags: ZoneServiceFlags = { ...ZONE_SERVICE_DEFAULTS };
  for (const s of stored) flags[s.service] = s.enabled;
  return flags;
}
