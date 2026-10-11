export type AuditErrorCode =
  'UNKNOWN_ACTION' | 'MODULE_MISMATCH' | 'NO_ACTOR' | 'ZONE_REQUIRED' | 'BAD_ENTITY';
/** Programming errors in how a service calls the audit service. They must never be swallowed. */
export class AuditError extends Error {
  constructor(
    public readonly code: AuditErrorCode,
    message: string,
  ) {
    super(`[audit:${code}] ${message}`);
    this.name = 'AuditError';
  }
}
