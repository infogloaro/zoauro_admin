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
  /** audit rows written in this request/job; read by the coverage guard */
  rowsWritten: number;
  /** record() calls skipped because nothing changed (TC-AUD-4); they still count as audited for the coverage guard */
  noops: number;
};

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: Omit<AuditContext, 'rowsWritten' | 'noops'>, fn: () => T): T {
  return storage.run({ ...ctx, rowsWritten: 0, noops: 0 }, fn);
}
export const getAuditContext = (): AuditContext | undefined => storage.getStore();

/** Jobs and webhooks have no signed-in user. Name appears in the log as "System: <job>". */
export function runAsSystem<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(
    { actor: { type: 'SYSTEM', id: null, name: `System: ${jobName}`, role: null }, rowsWritten: 0, noops: 0 },
    fn,
  );
}
