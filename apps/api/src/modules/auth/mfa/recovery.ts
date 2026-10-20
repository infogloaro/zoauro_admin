import { record } from '../../../lib/audit';
import type { SessionStore } from '../../../lib/auth/session-store';
import type { AuthMailer } from '../auth.mails';
import type { AuthDatabase, AuthTx, AuthUser } from '../auth.repository';

// Recovery (doc 52 section 2.5): there is no self-service "email me a link to disable 2-step". A Super Admin (route,
// STRONG re-auth) or an operator on the server (CLI, actor SYSTEM) resets a member's 2-step: every method and backup
// code goes, every session ends, the member is emailed and re-enrols with the mailbox proof at the next sign-in.

export interface ResetOutcome {
  methodsRemoved: number;
  sessionsRevoked: number;
}

/**
 * The reset itself, used by POST /members/{id}/mfa/reset and by the CLI. Runs in the caller's audit context (the
 * Super Admin's request, or runAsSystem for the CLI); `note` carries the reason (and for the CLI the operator).
 */
export async function resetMfa(
  deps: { db: AuthDatabase; sessions: SessionStore | null; mailer: AuthMailer; clock: () => Date },
  target: AuthUser,
  note: string,
): Promise<ResetOutcome> {
  const now = deps.clock();
  const outcome = await deps.db.transaction(async (tx) => {
    const methods = await tx.repo.disableAllMfaMethods(target.id, now);
    await tx.repo.deleteBackupCodes(target.id);
    await tx.repo.syncMfaEnabled(target.id);
    const sessions = await tx.repo.revokeAllSessions(target.id, now);
    await record(tx.audit, {
      module: 'auth',
      action: 'user.two_factor_reset',
      entity: { type: 'user', id: target.id, label: target.name },
      note,
    });
    for (const s of sessions) {
      await record(tx.audit, {
        module: 'auth',
        action: 'session.revoked',
        entity: { type: 'session', id: s.id, label: `${target.name} (${target.id})` },
        note: 'All sessions revoked by a 2-step reset',
      });
    }
    return { methodsRemoved: methods, sessions };
  });
  // a revoked session must not live on in the cache (CLI without Redis: the cache entries expire with the idle limit)
  if (deps.sessions) await deps.sessions.evictMany(outcome.sessions.map((s) => s.tokenHash));
  deps.mailer
    .sendMfaChanged({ to: target.email, name: target.name, at: now, change: 'RESET_BY_ADMIN' })
    .catch((err: unknown) =>
      console.error(`2-step reset mail failed (${err instanceof Error ? err.name : 'unknown'})`),
    );
  return { methodsRemoved: outcome.methodsRemoved, sessionsRevoked: outcome.sessions.length };
}

/**
 * Hook for M03 (doc 52 sections 2.3 and 2.5): when Super Admin changes a member's email, email OTP goes and the mailbox
 * must be proven again; when the phone changes, the number is no longer verified and SMS OTP goes. Runs inside the M03
 * transaction that changes the contact; audited as user.two_factor_disabled. Returns the methods removed.
 */
export async function clearMfaAfterContactChange(
  tx: AuthTx,
  target: AuthUser,
  change: 'EMAIL' | 'PHONE',
  now: Date,
): Promise<string[]> {
  const type = change === 'EMAIL' ? 'EMAIL_OTP' : 'SMS_OTP';
  if (change === 'PHONE') await tx.repo.clearPhoneVerified(target.id);
  const row = await tx.repo.findActiveMfaMethod(target.id, type);
  if (!row) return [];
  await tx.repo.disableMfaMethod(row.id, now);
  if (row.isPrimary) await tx.repo.setPrimaryMfaMethod(target.id, null);
  await tx.repo.syncMfaEnabled(target.id);
  await record(tx.audit, {
    module: 'auth',
    action: 'user.two_factor_disabled',
    entity: { type: 'user', id: target.id, label: target.name },
    before: { method: type },
    after: { method: null },
    note:
      change === 'EMAIL'
        ? 'Email address changed by a Super Admin'
        : 'Mobile number changed by a Super Admin',
  });
  return [type];
}
