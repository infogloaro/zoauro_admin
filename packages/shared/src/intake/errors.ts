// Integration API error codes (doc 42 section 4 and section 7, DUPLICATE_ORDER), additive to doc 09's list.
// INVALID_STATE_TRANSITION and RATE_LIMITED are doc 09 codes already, so they are not repeated here.

export const INTAKE_ERROR_STATUS = {
  SIGNATURE_INVALID: 401,
  TIMESTAMP_SKEW: 401,
  CLIENT_DISABLED: 403,
  SCOPE_DENIED: 403,
  /** a vendor or partner client acting on an order or record that belongs to someone else */
  ENTITY_MISMATCH: 403,
  CUSTOMER_BLOCKED: 403,
  UNKNOWN_ENTITY: 404,
  /** same Idempotency-Key, different body */
  IDEMPOTENCY_CONFLICT: 409,
  /** same Idempotency-Key while the first request is still running; retry with the same key */
  IDEMPOTENCY_IN_PROGRESS: 409,
  /** the app's order id was already used by this client (meta.orderId is the existing order) */
  DUPLICATE_ORDER: 409,
  /** an auto-assign offer that is no longer open (D154) */
  OFFER_EXPIRED: 409,
  /** address outside the vendor's zone, or the zone is not active */
  NOT_SERVICEABLE: 422,
  /** vendor inactive, suspended or closed */
  VENDOR_UNAVAILABLE: 422,
  PRICE_MISMATCH: 422,
  ITEM_UNAVAILABLE: 422,
  PARTNER_NOT_ELIGIBLE: 422,
} as const;
