import { z } from 'zod';
import {
  INTEGRATION_STATUSES,
  PARTNER_SETTLEMENT_STATUSES,
  THIRD_PARTY_PROVIDER_STATUSES,
} from './enums';
import { phoneSchema } from './vendor';

/**
 * Third-Party Partners contracts (task: Third-Party Partners page).
 *
 * A third-party provider is an external delivery company/service — a company
 * record, NOT an individual delivery partner. Own partners stay in
 * `delivery_partners` (M10); these rows never mix with them (task
 * constraint). Service coverage is many-to-many with zones.
 *
 * The endpoints below are task-authorized new contracts (owner-directed
 * feature; logged in doc 32 + the handoff). They mirror the M10 module's
 * shape: list + create + patch + status. No API-credential or secret field
 * exists anywhere in this contract — integration configuration is tracked
 * only as a status flag (`integrationStatus`), never as secrets (task
 * constraint).
 */

export const THIRD_PARTY_PROVIDER_SORT_FIELDS = ['createdAt', 'name'] as const;

const providerZoneRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
});

/** Free-form like `vehicleType` — no integration-type enum exists in the docs. */
const providerTypeSchema = z.string().trim().min(1, 'Provider type is required').max(40);

/** `?status=ACTIVE|INACTIVE|SUSPENDED` on the list. */
const providerStatusSchema = z.enum(THIRD_PARTY_PROVIDER_STATUSES);

/** Doc 08 `delivery_partners` row shape, adapted to a provider company. */
export const thirdPartyProviderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  providerType: z.string(),
  contactPerson: z.string(),
  /** Masked in list responses (`aa***@domain`, D26). */
  contactEmail: z.string(),
  /** Masked in list responses (`98****1234`, D26). */
  contactPhone: z.string(),
  status: z.enum(THIRD_PARTY_PROVIDER_STATUSES),
  /**
   * Configuration flag only — CONFIGURED never implies a live integration;
   * credentials and connectivity are server-side concerns that do not exist
   * yet (task constraint: do not claim an integration is operational).
   */
  integrationStatus: z.enum(INTEGRATION_STATUSES),
  /** Service zones (many-to-many, doc 36 zone chips). */
  zones: z.array(providerZoneRefSchema),
  deliveriesCount: z.number().int(),
  successfulDeliveries: z.number().int(),
  failedDeliveries: z.number().int(),
  /** Average delivery time in minutes; null = no deliveries yet. */
  avgDeliveryMinutes: z.number().int().nullable(),
  /** Integer paise (AGENTS.md money rule). */
  providerCostPaise: z.number().int(),
  settlementStatus: z.enum(PARTNER_SETTLEMENT_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ThirdPartyProvider = z.infer<typeof thirdPartyProviderSchema>;

/* ------------------------------------------------------------------ *
 * API payloads
 * ------------------------------------------------------------------ */

/**
 * POST /third-party-providers. `zoneIds` is the service coverage (at least
 * one, doc 36). No credential/secret field is accepted.
 */
export const thirdPartyProviderCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  providerType: providerTypeSchema,
  contactPerson: z.string().trim().min(2, 'Contact person is required').max(120),
  contactEmail: z.email('Enter a valid email').max(254),
  contactPhone: phoneSchema,
  zoneIds: z.array(z.uuid()).min(1, 'Choose at least one service zone'),
  status: providerStatusSchema.optional(),
  integrationStatus: z.enum(INTEGRATION_STATUSES).optional(),
});

export type ThirdPartyProviderCreateInput = z.infer<typeof thirdPartyProviderCreateSchema>;

/** PATCH /third-party-providers/{id} — profile + coverage + integration flag. */
export const thirdPartyProviderUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    providerType: providerTypeSchema.optional(),
    contactPerson: z.string().trim().min(2).max(120).optional(),
    contactEmail: z.email('Enter a valid email').max(254).optional(),
    contactPhone: phoneSchema.optional(),
    zoneIds: z.array(z.uuid()).min(1, 'Choose at least one service zone').optional(),
    integrationStatus: z.enum(INTEGRATION_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export type ThirdPartyProviderUpdateInput = z.infer<typeof thirdPartyProviderUpdateSchema>;

/**
 * POST /third-party-providers/{id}/status — the enable/disable lever
 * (ACTIVE ⇄ INACTIVE) plus SUSPENDED, mirroring the vendor status style
 * (doc 10 §4 targets).
 */
export const thirdPartyProviderStatusSchema = z.object({
  status: z.enum(THIRD_PARTY_PROVIDER_STATUSES),
});

export type ThirdPartyProviderStatusInput = z.infer<typeof thirdPartyProviderStatusSchema>;

/* ------------------------------------------------------------------ *
 * List query
 * ------------------------------------------------------------------ */

export const listThirdPartyProvidersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: providerStatusSchema.optional(),
  integrationStatus: z.enum(INTEGRATION_STATUSES).optional(),
  settlementStatus: z.enum(PARTNER_SETTLEMENT_STATUSES).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt|name)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});

export type ListThirdPartyProvidersQuery = z.infer<typeof listThirdPartyProvidersQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09 convention). */
export function requestedProviderZoneIds(
  query: ListThirdPartyProvidersQuery,
): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export const thirdPartyProviderCountsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  /** Sum of `deliveriesCount` over the scoped rows. */
  deliveries: z.number().int(),
  /** Sum of `successfulDeliveries` over the scoped rows. */
  successful: z.number().int(),
  /** Sum of `providerCostPaise` (integer paise). */
  providerCostPaise: z.number().int(),
});

export const thirdPartyProviderFacetsSchema = z.object({
  zones: z.array(providerZoneRefSchema),
  providerTypes: z.array(z.string()),
});

export const listThirdPartyProvidersResponseSchema = z.object({
  data: z.array(thirdPartyProviderSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: thirdPartyProviderCountsSchema,
    facets: thirdPartyProviderFacetsSchema,
  }),
});

export type ListThirdPartyProvidersResponse = z.infer<typeof listThirdPartyProvidersResponseSchema>;

/* ------------------------------------------------------------------ *
 * Add/Edit forms — all-string values for react-hook-form; the
 * `thirdPartyProviderFormTo*` mappers produce the API payloads above.
 * ------------------------------------------------------------------ */

export const thirdPartyProviderFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  providerType: providerTypeSchema,
  contactPerson: z.string().trim().min(2, 'Contact person is required').max(120),
  contactEmail: z.email('Enter a valid email').max(254),
  contactPhone: phoneSchema,
  zoneIds: z.array(z.string()).min(1, 'Choose at least one service zone'),
  status: providerStatusSchema,
  integrationStatus: z.enum(INTEGRATION_STATUSES),
});

export type ThirdPartyProviderFormValues = z.infer<typeof thirdPartyProviderFormSchema>;

export const thirdPartyProviderEditFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  providerType: providerTypeSchema,
  contactPerson: z.string().trim().min(2).max(120),
  contactEmail: z.email('Enter a valid email').max(254),
  contactPhone: phoneSchema,
  zoneIds: z.array(z.string()).min(1, 'Choose at least one service zone'),
  integrationStatus: z.enum(INTEGRATION_STATUSES),
});

export type ThirdPartyProviderEditFormValues = z.infer<typeof thirdPartyProviderEditFormSchema>;

export function thirdPartyProviderFormToPayload(
  form: ThirdPartyProviderFormValues,
): ThirdPartyProviderCreateInput {
  return {
    name: form.name,
    providerType: form.providerType,
    contactPerson: form.contactPerson,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    zoneIds: form.zoneIds,
    status: form.status,
    integrationStatus: form.integrationStatus,
  };
}

export function thirdPartyProviderEditFormToUpdate(
  form: ThirdPartyProviderEditFormValues,
): ThirdPartyProviderUpdateInput {
  return {
    name: form.name,
    providerType: form.providerType,
    contactPerson: form.contactPerson,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    zoneIds: form.zoneIds,
    integrationStatus: form.integrationStatus,
  };
}
