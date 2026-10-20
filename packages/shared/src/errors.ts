import { z } from 'zod';
import { ZONE_ERROR_STATUS } from './zones/errors';

// Error codes and the standard error body (doc 09 "Errors"). Single definition for the API, the generated OpenAPI
// document and the web client. PASSWORD_CHANGE_REQUIRED (first-login password change pending) is added to doc 09's list.

export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ZONE_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_STATE_TRANSITION: 409,
  REFUND_LIMIT_EXCEEDED: 403,
  REAUTH_REQUIRED: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  // doc 52 section 8 (2-step enrolment and management)
  SMS_NOT_AVAILABLE: 409,
  PHONE_MISSING: 409,
  LAST_METHOD_REQUIRED: 409,
  /** optimistic locking: the record changed since it was read; meta.current holds the newer values (R-ZONE-9) */
  STALE_VERSION: 409,
  // doc 53 section 5 (zones)
  ...ZONE_ERROR_STATUS,
  /** a category with live menu items cannot be deleted (SA-2.4) */
  CATEGORY_IN_USE: 409,
  /** D127: the stay overlaps total_rooms blocking bookings on at least one night */
  NO_ROOMS_AVAILABLE: 409,
  /** a dependency (object storage, payment gateway) is unreachable or not configured; try again later (doc 32) */
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), issue: z.string() })).optional(),
    /**
     * Structured data of a few codes (additive to doc 09's envelope, doc 32): PINCODE_OVERLAP { conflicts },
     * ZONE_NOT_ACTIVATABLE { missing }, ZONE_HAS_HISTORY { counts }, STALE_VERSION { current }, IMPACT_CHANGED { impact }.
     */
    meta: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
