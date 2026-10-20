export { record, recordMany, createAudit } from './audit.service';
export type { AuditEntry, AuditRow, AuditTx, AuditDeps, Audit } from './audit.service';
export {
  runAsSystem,
  runWithAuditContext,
  getAuditContext,
  countAudit,
  noteAuditNoop,
} from './context';
export type { AuditActor, AuditContext, AuditTally } from './context';
export { diff } from './diff';
export { redact, maskEmail, maskPhone, maskTail } from './redact';
export { classifyField } from './registry';
export { findUncoveredSecretLikeColumns } from './schema-walker';
export { AuditError } from './errors';
export { uuidv7, createUuidV7, uuidv7Bounds } from './id';
export { InMemoryDeniedRateLimiter, RedisDeniedRateLimiter } from './rate-limit';
export type { DeniedRateLimiter } from './rate-limit';
export { auditContextMiddleware, auditMeta, auditCoverage } from './middleware';
export type { AuditMetaHandler } from './middleware';
export { evaluateCoverage, checkOpenApiAuditMetadata, AUDIT_NONE_REASONS } from './coverage';
export type { AuditRouteMeta, CoverageViolation } from './coverage';
