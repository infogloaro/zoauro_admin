// Zone error codes and their HTTP status (doc 53 section 5). Part of the shared error list (ERROR_STATUS in ../errors.ts)
// since the zones API exists (P11). Structured data (conflicts, missing, counts) travels in `error.meta` (doc 32).

export const ZONE_ERROR_STATUS = {
  ZONE_NAME_TAKEN: 409,
  ZONE_CODE_TAKEN: 409,
  /** meta: conflicts [{ pincode, zoneId, zoneName }] */
  PINCODE_OVERLAP: 409,
  RANGE_TOO_LARGE: 422,
  /** PATCH tried to change `code` (R-ZONE-3, TC-ZONE-12) */
  CODE_IMMUTABLE: 422,
  /** meta: missing [...] (name, city, state, pincodes, deliveryCharge) */
  ZONE_NOT_ACTIVATABLE: 422,
  /** the impact counts moved since the deactivate dialog loaded; meta: impact (the current one) */
  IMPACT_CHANGED: 409,
  REASON_REQUIRED: 422,
  /** meta: counts; delete is allowed only for a pristine zone */
  ZONE_HAS_HISTORY: 409,
  /** D92: the service is switched off in this zone; new onboarding and new orders for it are refused. meta: { service } */
  ZONE_SERVICE_DISABLED: 409,
} as const;

export type ZoneErrorCode = keyof typeof ZONE_ERROR_STATUS;
export const ZONE_ERROR_CODES = Object.keys(ZONE_ERROR_STATUS) as ZoneErrorCode[];
