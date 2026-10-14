import { z } from 'zod';
import {
  cursorMetaSchema,
  DEFAULT_CURSOR_LIMIT,
  MAX_PAGE_SIZE,
  pageMetaSchema,
} from '../pagination';
import { ZONE_PLACE_MAX, PINCODE_SOURCES, ZONE_STATUSES } from './schemas';

// Zone API parameters and responses (doc 53 section 5), shared with the zone screens and the OpenAPI document.

export const zoneIdParamsSchema = z.object({ id: z.uuid() });

/** GET /zones: `?status&state&q` and a cursor (the last id of the previous page, zones in creation order). */
export const zoneListQuerySchema = z.object({
  status: z.enum(ZONE_STATUSES).optional(),
  state: z.string().trim().min(1).max(ZONE_PLACE_MAX).optional(),
  /** name, code or city contains (case-insensitive) */
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_CURSOR_LIMIT),
  after: z.uuid().optional(),
});
export type ZoneListQuery = z.infer<typeof zoneListQuerySchema>;

/** GET /zones/{id}: the pincode list is paged and searchable (prefix). */
export const ZONE_PINCODE_PAGE_MAX = 500;
export const zoneDetailQuerySchema = z.object({
  pincodePage: z.coerce.number().int().min(1).default(1),
  pincodePageSize: z.coerce.number().int().min(1).max(ZONE_PINCODE_PAGE_MAX).default(100),
  pincodeQ: z
    .string()
    .trim()
    .regex(/^[0-9]{1,6}$/)
    .optional(),
});
export type ZoneDetailQuery = z.infer<typeof zoneDetailQuerySchema>;

/** PUT /zones/{id}/pincodes?preview=true: a dry run that writes nothing. */
export const zonePincodesQuerySchema = z.object({
  preview: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const iso = z.iso.datetime();
const count = z.number().int().min(0);

/**
 * Modules whose counts feed the list, the impact check and the team (doc 53 section 7). While a module is not built
 * its source is a stub: the response says `partial: true` and names it in `missingSources`.
 */
export const ZONE_COUNT_SOURCES = [
  'restaurants',
  'homemakers',
  'delivery',
  'customers',
  'orders',
  'access',
  'registrations',
  'refunds',
  'payouts',
] as const;
export type ZoneCountSource = (typeof ZONE_COUNT_SOURCES)[number];
const partialFields = {
  partial: z.boolean(),
  missingSources: z.array(z.enum(ZONE_COUNT_SOURCES)),
};

export const zoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  /** the entered range (display only); the truth is the pincode list */
  pincodeFrom: z.string().nullable(),
  pincodeTo: z.string().nullable(),
  pincodeCount: count,
  deliveryChargePaise: count,
  status: z.enum(ZONE_STATUSES),
  colorHex: z.string(),
  description: z.string().nullable(),
  version: z.number().int().min(1),
  activatedAt: iso.nullable(),
  deactivatedAt: iso.nullable(),
  deactivationReason: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type ZoneDto = z.infer<typeof zoneSchema>;

/** List columns (doc 53 section 6): records per module in the zone. */
export const zoneCountsSchema = z.object({
  restaurants: count,
  homemakers: count,
  partners: count,
  customers: count,
  members: count,
});
export type ZoneCounts = z.infer<typeof zoneCountsSchema>;

export const zoneTeamSummarySchema = z.object({
  total: count,
  /** avatars: the first three members */
  top: z.array(z.object({ userId: z.uuid(), name: z.string() })).max(3),
});

export const zoneListItemSchema = zoneSchema.extend({
  counts: zoneCountsSchema,
  team: zoneTeamSummarySchema,
});
export const zoneListResponseSchema = z.object({
  data: z.array(zoneListItemSchema),
  meta: cursorMetaSchema,
  ...partialFields,
});

export const zoneSummarySchema = z.object({
  total: count,
  active: count,
  inactive: count,
  upcoming: count,
  /** zones with no member (R-ACC-4); not known while the access source is a stub */
  withoutTeam: count,
  ...partialFields,
});

export const zonePincodeRowSchema = z.object({
  pincode: z.string(),
  source: z.enum(PINCODE_SOURCES),
  createdAt: iso,
});
export const zoneDetailResponseSchema = zoneSchema.extend({
  counts: zoneCountsSchema,
  team: zoneTeamSummarySchema,
  pincodes: z.object({ data: z.array(zonePincodeRowSchema), meta: pageMetaSchema }),
  ...partialFields,
});

export const pincodeConflictSchema = z.object({
  pincode: z.string(),
  zoneId: z.uuid(),
  zoneName: z.string(),
});
export type PincodeConflict = z.infer<typeof pincodeConflictSchema>;

/** A vendor or partner registered in the zone at a pincode that is being removed (R-ZONE-8: never moved). */
export const pincodeMismatchSchema = z.object({
  entityType: z.enum(['restaurant', 'homemaker', 'partner']),
  id: z.uuid(),
  name: z.string(),
  pincode: z.string(),
});
export type PincodeMismatch = z.infer<typeof pincodeMismatchSchema>;

export const zonePincodesResultSchema = z.object({
  preview: z.boolean(),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  /** only in a preview: pincodes another zone owns (a real save answers 409 PINCODE_OVERLAP instead) */
  conflicts: z.array(pincodeConflictSchema),
  mismatches: z.array(pincodeMismatchSchema),
  /** the zone after the change (unchanged in a preview) */
  zone: zoneSchema,
  ...partialFields,
});

export const zoneLookupResponseSchema = z.object({
  pincode: z.string(),
  zone: z
    .object({
      id: z.uuid(),
      name: z.string(),
      code: z.string(),
      status: z.enum(ZONE_STATUSES),
    })
    .nullable(),
});

/** GET /zones/{id}/impact (doc 53 section 2.2 item 5). */
export const zoneImpactCountsSchema = z.object({
  openOrders: count,
  openOrdersByStatus: z.record(z.string(), count),
  scheduledOrders: count,
  restaurants: count,
  homemakers: count,
  partners: count,
  partnersOnline: count,
  members: count,
  pendingRegistrations: count,
  pendingRefunds: count,
  pendingPayouts: count,
});
export type ZoneImpactCounts = z.infer<typeof zoneImpactCountsSchema>;
export const zoneImpactSchema = z.object({
  zoneId: z.uuid(),
  counts: zoneImpactCountsSchema,
  /** send back with POST /deactivate; a different value then means the numbers moved (409 IMPACT_CHANGED) */
  impactVersion: z.string(),
  ...partialFields,
});
export type ZoneImpact = z.infer<typeof zoneImpactSchema>;

/** GET /zones/{id}/team: the members with an active assignment in the zone (M03, doc 09). */
export const zoneTeamMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  /** the member account: ACTIVE or SUSPENDED (D102) */
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  assignmentId: z.uuid(),
  assignedAt: iso,
  profileId: z.uuid(),
  profileName: z.string(),
  overridesCount: count,
  limits: z.object({
    perRefundPaise: count,
    dailyRefundPaise: count,
    canReveal: z.boolean(),
    canExport: z.boolean(),
  }),
});
export const zoneTeamResponseSchema = z.object({
  data: z.array(zoneTeamMemberSchema),
  ...partialFields,
});
