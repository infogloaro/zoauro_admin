import type { AuditActionKey, AuditModule } from './shared';
import { AUDIT_ACTIONS, isAuditActionKey } from './shared';

/** Reasons a mutating route may legitimately write no audit row. Keep this list short; every entry needs a reason. */
export const AUDIT_NONE_REASONS = {
  logout: 'Session end; nothing to attribute',
  'token-refresh': 'Session refresh; no state change',
  health: 'Infrastructure probe',
  login: 'Recorded in login_history by M01',
  reauth: 'Successful re-authentication changes nothing; failures are audited (reauth.failed)',
  'otp-send': 'Sending a one-time code is counted and capped, not audited (doc 52 section 4, T29)',
  'mfa-enrolment-step':
    'Starting an authenticator set-up changes nothing until it is confirmed (audited as user.two_factor_enrolled)',
  'mfa-preference': 'Choosing the preferred 2-step method changes no security setting',
} as const;
export type AuditNoneReason = keyof typeof AUDIT_NONE_REASONS;

export type AuditRouteMeta =
  { module: AuditModule; action: AuditActionKey } | { none: AuditNoneReason };

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export type CoverageViolation =
  | { kind: 'MISSING_METADATA'; method: string; path: string }
  | { kind: 'BAD_METADATA'; method: string; path: string; detail: string }
  | { kind: 'NO_AUDIT_ROW'; method: string; path: string; action: string };

export function validateMeta(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return 'not an object';
  if ('none' in meta) {
    const r = (meta as { none: unknown }).none;
    return typeof r === 'string' && Object.prototype.hasOwnProperty.call(AUDIT_NONE_REASONS, r)
      ? null
      : `unknown none-reason "${String(r)}"`;
  }
  const { module, action } = meta as { module?: unknown; action?: unknown };
  if (typeof action !== 'string' || !isAuditActionKey(action))
    return `unknown action "${String(action)}"`;
  if (AUDIT_ACTIONS[action].module !== module)
    return `action ${action} belongs to module ${AUDIT_ACTIONS[action].module}`;
  return null;
}

/** Runtime check after a response finished. */
export function evaluateCoverage(i: {
  method: string;
  path: string;
  status: number;
  meta: unknown;
  rowsWritten: number;
  noops: number;
}): CoverageViolation | null {
  if (!MUTATING_METHODS.has(i.method.toUpperCase())) return null;
  if (i.status < 200 || i.status >= 300) return null;
  if (i.meta === undefined) return { kind: 'MISSING_METADATA', method: i.method, path: i.path };
  const bad = validateMeta(i.meta);
  if (bad) return { kind: 'BAD_METADATA', method: i.method, path: i.path, detail: bad };
  if ('none' in (i.meta as object)) return null;
  if (i.rowsWritten + i.noops === 0)
    return {
      kind: 'NO_AUDIT_ROW',
      method: i.method,
      path: i.path,
      action: (i.meta as { action: string }).action,
    };
  return null;
}

/** Static check for the authorization harness (F1.6): every mutating OpenAPI operation must carry `x-audit`. */
export function checkOpenApiAuditMetadata(spec: {
  paths?: Record<string, Record<string, unknown> | undefined>;
}): CoverageViolation[] {
  const out: CoverageViolation[] = [];
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops ?? {})) {
      if (!MUTATING_METHODS.has(method.toUpperCase())) continue;
      const meta =
        typeof op === 'object' && op !== null
          ? (op as Record<string, unknown>)['x-audit']
          : undefined;
      if (meta === undefined) {
        out.push({ kind: 'MISSING_METADATA', method: method.toUpperCase(), path });
        continue;
      }
      const bad = validateMeta(meta);
      if (bad) out.push({ kind: 'BAD_METADATA', method: method.toUpperCase(), path, detail: bad });
    }
  }
  return out;
}
