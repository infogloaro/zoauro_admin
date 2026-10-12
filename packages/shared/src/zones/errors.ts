// Zone error codes and their HTTP status (doc 53 section 5). The zones API (P11) adds them to the shared error list
// (ERROR_STATUS) when its routes exist; until then they are defined here only, so the OpenAPI document is unchanged.

export const ZONE_ERROR_STATUS = {
  ZONE_NAME_TAKEN: 409,
  ZONE_CODE_TAKEN: 409,
  /** details: conflicts [{ pincode, zoneName }] */
  PINCODE_OVERLAP: 409,
  RANGE_TOO_LARGE: 422,
  /** details: missing [...] (name, city, state, pincodes, deliveryCharge) */
  ZONE_NOT_ACTIVATABLE: 422,
  /** the impact counts moved since the deactivate dialog loaded */
  IMPACT_CHANGED: 409,
  REASON_REQUIRED: 422,
  /** details: counts; delete is allowed only for a pristine zone */
  ZONE_HAS_HISTORY: 409,
} as const;

export type ZoneErrorCode = keyof typeof ZONE_ERROR_STATUS;
export const ZONE_ERROR_CODES = Object.keys(ZONE_ERROR_STATUS) as ZoneErrorCode[];
