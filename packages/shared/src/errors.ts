import { z } from 'zod';

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
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), issue: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
