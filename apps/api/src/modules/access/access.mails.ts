import { escapeHtml, type MailMessage, type Mailer } from '../../lib/mailer';

// Emails to a member about their account (doc 09 PUT access "email to member", TC-AC-13; D103). None carries a password
// or a link that signs in.

export interface AccessMailer {
  /** zones added or removed, or what the member may do in a zone changed */
  sendAccessChanged(m: {
    to: string;
    name: string;
    added: string[];
    removed: string[];
    changed: string[];
  }): Promise<void>;
  /** a Super Admin set a new temporary password; it is never in the email (D103) */
  sendPasswordResetByAdmin(m: { to: string; name: string }): Promise<void>;
  /** R13: a Zonal Admin asked for access (to every active Super Admin) */
  sendAccessRequestCreated(m: {
    to: string;
    requester: string;
    zone: string;
    what: string;
  }): Promise<void>;
  /** R13: the decision, to the requester */
  sendAccessRequestDecided(m: {
    to: string;
    name: string;
    approved: boolean;
    zone: string;
    what: string;
    reason: string;
  }): Promise<void>;
  /** D148: to a new Super Admin; no password (D103): the creator gives the temporary one */
  sendSuperAdminCreated?(m: { to: string; name: string }): Promise<void>;
  /** D148: to every other active Super Admin */
  sendSuperAdminAdded?(m: { to: string; name: string; added: string }): Promise<void>;
  /** D178: a change of areas or primary status, to the affected Super Admin and the actor */
  sendSuperAdminChanged?(m: { to: string; name: string; change: string }): Promise<void>;
}

export const noopAccessMailer: AccessMailer = {
  sendAccessChanged: async () => undefined,
  sendPasswordResetByAdmin: async () => undefined,
  sendAccessRequestCreated: async () => undefined,
  sendAccessRequestDecided: async () => undefined,
};

function message(to: string, subject: string, lines: string[]): MailMessage {
  return {
    to,
    subject,
    text: lines.join('\n'),
    html: lines
      .filter((l) => l !== '')
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join('\n'),
  };
}

const list = (names: string[]): string => names.join(', ');

export function createAccessMailer(mailer: Mailer, opts: { appUrl: string }): AccessMailer {
  const signIn = `${opts.appUrl.replace(/\/+$/, '')}/login`;
  return {
    sendAccessChanged: (m) =>
      mailer.send(
        message(m.to, 'Your ZOAURO Admin access changed', [
          `Hello ${m.name},`,
          'A Super Admin changed your access in ZOAURO Admin. It applies from your next action.',
          ...(m.added.length > 0 ? [`Zones added: ${list(m.added)}`] : []),
          ...(m.removed.length > 0 ? [`Zones removed: ${list(m.removed)}`] : []),
          ...(m.changed.length > 0 ? [`Permissions or limits changed in: ${list(m.changed)}`] : []),
          'If you think this is a mistake, ask your Super Admin.',
        ]),
      ),
    sendPasswordResetByAdmin: (m) =>
      mailer.send(
        message(m.to, 'Your ZOAURO Admin password was reset', [
          `Hello ${m.name},`,
          'A Super Admin set a new temporary password for your account and signed out all your devices.',
          'Ask your Super Admin for the temporary password; you will choose your own at the next sign-in.',
          `Sign in at ${signIn}`,
        ]),
      ),
    sendAccessRequestCreated: (m) =>
      mailer.send(
        message(m.to, 'New access request in ZOAURO Admin', [
          `${m.requester} asked for ${m.what} in ${m.zone}.`,
          'Review it in ZOAURO Admin under Access requests. Nothing changes until a Super Admin approves it.',
        ]),
      ),
    sendAccessRequestDecided: (m) =>
      mailer.send(
        message(m.to, `Your access request was ${m.approved ? 'approved' : 'rejected'}`, [
          `Hello ${m.name},`,
          `Your request for ${m.what} in ${m.zone} was ${m.approved ? 'approved. It applies from your next action' : 'rejected'}.`,
          `Reason: ${m.reason}`,
        ]),
      ),
    sendSuperAdminCreated: (m) =>
      mailer.send(
        message(m.to, 'You are a ZOAURO Admin Super Admin', [
          `Hello ${m.name},`,
          'A Super Admin created a Super Admin account for you in ZOAURO Admin.',
          'Ask that Super Admin for the temporary password; you will choose your own and set up 2-step verification at the first sign-in.',
          `Sign in at ${signIn}`,
        ]),
      ),
    sendSuperAdminChanged: (m) =>
      mailer.send(
        message(m.to, 'Super Admin access changed in ZOAURO Admin', [
          `Hello ${m.name},`,
          `${m.change}. It applies from the next action.`,
          'If you did not expect this, check Settings > Super Admins and the audit log at once.',
        ]),
      ),
    sendSuperAdminAdded: (m) =>
      mailer.send(
        message(m.to, 'A new Super Admin was added in ZOAURO Admin', [
          `Hello ${m.name},`,
          `${m.added} was made a Super Admin. If you did not expect this, check Settings > Super Admins and the audit log at once.`,
        ]),
      ),
  };
}
