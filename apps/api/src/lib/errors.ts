/**
 * Typed application errors (doc 07 §6, doc 09 error contract).
 * The error middleware renders these as
 * `{ error: { code, message, details?, requestId } }`.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ZONE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_STATE_TRANSITION'
  | 'REFUND_LIMIT_EXCEEDED'
  | 'REAUTH_REQUIRED'
  | 'INTERNAL';

export interface ErrorDetail {
  field?: string;
  issue: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, httpStatus: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export const errors = {
  unauthenticated: (message = 'Authentication required') =>
    new AppError('UNAUTHENTICATED', 401, message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', 403, message),
  notFound: (message = 'Resource not found') => new AppError('NOT_FOUND', 404, message),
  zoneNotFound: () => new AppError('ZONE_NOT_FOUND', 404, 'Zone not found'),
  validation: (details: ErrorDetail[], message = 'Invalid input') =>
    new AppError('VALIDATION_ERROR', 422, message, details),
  conflict: (message: string, details?: ErrorDetail[]) =>
    new AppError('CONFLICT', 409, message, details),
  rateLimited: (message = 'Too many requests, please try again later') =>
    new AppError('RATE_LIMITED', 429, message),
  invalidStateTransition: (message: string) =>
    new AppError('INVALID_STATE_TRANSITION', 409, message),
  reauthRequired: (message = 'Please confirm your password to continue') =>
    new AppError('REAUTH_REQUIRED', 401, message),
  internal: (message = 'Something went wrong') => new AppError('INTERNAL', 500, message),
};
