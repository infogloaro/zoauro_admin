import { AsyncLocalStorage } from 'node:async_hooks';

export type AuditActorType = 'USER' | 'APP_CLIENT' | 'SYSTEM' | 'WEBHOOK';
export type AuditActor = {
  type: AuditActorType;
  id: string | null;
  name: string; // snapshot, survives renames and soft deletes
  role: string | null;
};
export type AuditContext = {
  actor: AuditActor;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
};

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run({ ...ctx }, fn);
}
export const getAuditContext = (): AuditContext | undefined => storage.getStore();

/** Jobs and webhooks have no signed-in user. Name appears in the log as "System: <job>". */
export function runAsSystem<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(
    { actor: { type: 'SYSTEM', id: null, name: `System: ${jobName}`, role: null } },
    fn,
  );
}

/**
 * What one HTTP request audited, read by the coverage guard. Kept apart from the actor context on purpose: a service
 * may open its own context (AuthService.asUser for forgot/reset password, where nobody is signed in) and its rows must
 * still count for the request.
 */
export type AuditTally = {
  rowsWritten: number;
  /** record() calls skipped because nothing changed (TC-AUD-4); they still count as audited (TC-AUD-27) */
  noops: number;
};
const tallies = new AsyncLocalStorage<AuditTally>();

export function runWithAuditTally<T>(tally: AuditTally, fn: () => T): T {
  return tallies.run(tally, fn);
}
export function countAudit(kind: keyof AuditTally, n = 1): void {
  const t = tallies.getStore();
  if (t) t[kind] += n;
}
/**
 * The request deliberately changed nothing and so records nothing (forgot-password for an unknown email answers
 * exactly like a known one). Counts as an audited no-op for the coverage guard.
 */
export const noteAuditNoop = (): void => countAudit('noops');
