import { AuditError } from './errors';
import { countAudit, getAuditContext } from './context';
import type { AuditActor } from './context';
import { diff } from './diff';
import { uuidv7 } from './id';
import { redact } from './redact';
import type { DeniedRateLimiter } from './rate-limit';
import {
  AUDIT_ACTIONS,
  ZONE_EXPLICIT_ENTITY_TYPES,
  ZONE_REQUIRED_ENTITY_TYPES,
  isAuditActionKey,
} from './shared';
import type { AuditActionKey, AuditModule } from './shared';

export type AuditEntry = {
  module: AuditModule;
  action: AuditActionKey;
  entity: {
    type: string;
    id?: string | undefined;
    label?: string | undefined;
    zoneId?: string | null | undefined;
  };
  /** full or partial object: diffed and redacted inside. Omit both for event-style actions (reveal, view, export). */
  before?: unknown;
  after?: unknown;
  note?: string | undefined;
};

/** Row shape written to `audit_logs`. Absent JSON is `undefined`, never `null` (Prisma needs DbNull for null Json). */
export type AuditRow = {
  id: string;
  actorType: 'USER' | 'APP_CLIENT' | 'SYSTEM' | 'WEBHOOK';
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  zoneId: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  outcome: 'SUCCESS' | 'DENIED';
  sensitivity: 'NORMAL' | 'HIGH';
  beforeJson?: unknown;
  afterJson?: unknown;
  note: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

/** The only thing the service needs from a Prisma transaction client (it satisfies this structurally via a thin adapter). */
export interface AuditTx {
  auditLog: {
    create(args: { data: AuditRow }): Promise<unknown>;
    createMany(args: { data: AuditRow[] }): Promise<unknown>;
  };
}
export interface AuditDeps {
  /** runs fn in its own short transaction (used only by recordDenied) */
  transaction<T>(fn: (tx: AuditTx) => Promise<T>): Promise<T>;
  deniedLimiter: DeniedRateLimiter;
  onDeniedFailure?: (err: unknown) => void;
}

const UA_MAX = 300;

function requireActor(): {
  actor: AuditActor;
  ctx: NonNullable<ReturnType<typeof getAuditContext>>;
} {
  const ctx = getAuditContext();
  if (!ctx)
    throw new AuditError(
      'NO_ACTOR',
      'no audit context: wrap the request with the context middleware or the job with runAsSystem()',
    );
  return { actor: ctx.actor, ctx };
}

/**
 * An app sign-up whose address matched no zone (doc 45 section 1.2, IH-2): the record exists with no zone until the Super
 * Admin assigns one, so its audit row has none either and only Super Admin sees it. Allowed for these types only, only
 * for an app or system actor, and only when null is passed explicitly (a forgotten zone still fails).
 */
const UNZONED_SIGNUP_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'restaurant',
  'homemaker',
  'partner',
]);
const UNZONED_SIGNUP_ACTORS: ReadonlySet<AuditActor['type']> = new Set(['APP_CLIENT', 'SYSTEM']);

function validate(e: AuditEntry, actorType: AuditActor['type']): { zoneId: string | null } {
  if (!isAuditActionKey(e.action))
    throw new AuditError(
      'UNKNOWN_ACTION',
      `"${String(e.action)}" is not in AUDIT_ACTIONS (add it to packages/shared/src/audit/actions.ts first)`,
    );
  const def = AUDIT_ACTIONS[e.action];
  if (def.module !== e.module)
    throw new AuditError(
      'MODULE_MISMATCH',
      `${e.action} belongs to module "${def.module}", got "${e.module}"`,
    );
  if (!e.entity.type) throw new AuditError('BAD_ENTITY', 'entity.type is required');
  const zone = e.entity.zoneId;
  const unzonedSignup =
    zone === null &&
    UNZONED_SIGNUP_ENTITY_TYPES.has(e.entity.type) &&
    UNZONED_SIGNUP_ACTORS.has(actorType);
  if (ZONE_REQUIRED_ENTITY_TYPES.has(e.entity.type) && typeof zone !== 'string' && !unzonedSignup) {
    throw new AuditError(
      'ZONE_REQUIRED',
      `entity type "${e.entity.type}" is zone-owned: pass entity.zoneId (a uuid)`,
    );
  }
  if (ZONE_EXPLICIT_ENTITY_TYPES.has(e.entity.type) && zone === undefined) {
    throw new AuditError(
      'ZONE_REQUIRED',
      `entity type "${e.entity.type}": pass entity.zoneId explicitly (uuid, or null if truly global)`,
    );
  }
  return { zoneId: typeof zone === 'string' ? zone : null };
}

function toRow(e: AuditEntry, outcome: 'SUCCESS' | 'DENIED'): AuditRow | null {
  const { actor, ctx } = requireActor();
  const { zoneId } = validate(e, actor.type);
  const def = AUDIT_ACTIONS[e.action];

  let beforeJson: unknown;
  let afterJson: unknown;
  if (e.before !== undefined || e.after !== undefined) {
    const d = diff(e.before, e.after);
    if (d.isNoop) {
      countAudit('noops');
      return null;
    } // TC-AUD-4: nothing changed, nothing recorded
    beforeJson = d.before === null ? undefined : redact(d.before);
    afterJson = d.after === null ? undefined : redact(d.after);
  }
  return {
    id: uuidv7(),
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    zoneId,
    module: e.module,
    action: e.action,
    entityType: e.entity.type,
    entityId: e.entity.id ?? null,
    entityLabel: e.entity.label ?? null,
    outcome,
    sensitivity: def.sensitivity,
    ...(beforeJson === undefined ? {} : { beforeJson }),
    ...(afterJson === undefined ? {} : { afterJson }),
    note: e.note ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ? ctx.userAgent.slice(0, UA_MAX) : null,
    requestId: ctx.requestId ?? null,
  };
}

/** Inside the caller's transaction. Throws on programmer errors and on insert failure: the caller's transaction then rolls back (fail closed, D61). */
export async function record(tx: AuditTx, e: AuditEntry): Promise<void> {
  const row = toRow(e, 'SUCCESS');
  if (!row) return;
  await tx.auditLog.create({ data: row });
  countAudit('rowsWritten');
}

export async function recordMany(tx: AuditTx, entries: AuditEntry[]): Promise<void> {
  const rows = entries.map((e) => toRow(e, 'SUCCESS')).filter((r): r is AuditRow => r !== null);
  if (rows.length === 0) return;
  await tx.auditLog.createMany({ data: rows });
  countAudit('rowsWritten', rows.length);
}

export function createAudit(deps: AuditDeps) {
  /** DENIED attempts: own short transaction, rate limited, and a failure here never hides the 403/404 the caller is about to return. */
  async function recordDenied(e: Omit<AuditEntry, 'before' | 'after'>): Promise<boolean> {
    const row = toRow(e, 'DENIED'); // programmer errors still throw
    if (!row) return false;
    const key = `${row.actorId ?? row.actorName}:${row.action}`;
    try {
      if (!(await deps.deniedLimiter.tryAcquire(key, 60))) return false;
      await deps.transaction((tx) => tx.auditLog.create({ data: row }));
      return true;
    } catch (err) {
      deps.onDeniedFailure?.(err);
      return false;
    }
  }
  return { record, recordMany, recordDenied };
}
export type Audit = ReturnType<typeof createAudit>;
