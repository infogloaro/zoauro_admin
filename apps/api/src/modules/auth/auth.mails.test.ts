import { describe, expect, it } from 'vitest';
import type { MailMessage, Mailer } from '../../lib/mailer';
import { createAuthMailer, formatIst } from './auth.mails';

function capture() {
  const sent: MailMessage[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  return { sent, auth: createAuthMailer(mailer, { appUrl: 'https://admin.zoauro.test/' }) };
}
const at = new Date('2026-10-12T08:30:00Z'); // 14:00 IST

describe('auth emails (doc 52 section 2.7)', () => {
  it('reset: a single-use link to /reset-password with the encoded token and the IST expiry', async () => {
    const { sent, auth } = capture();
    await auth.sendPasswordReset({
      to: 'a@example.test',
      name: 'Asha',
      token: 'ab+c/d=',
      expiresAt: at,
    });
    const m = sent[0];
    expect(m?.to).toBe('a@example.test');
    expect(m?.text).toContain('https://admin.zoauro.test/reset-password?token=ab%2Bc%2Fd%3D');
    expect(m?.html).toContain(
      'href="https://admin.zoauro.test/reset-password?token=ab%2Bc%2Fd%3D"',
    );
    expect(m?.text).toContain(formatIst(at));
  });

  it('new login: time in IST, IP and device; no link at all', async () => {
    const { sent, auth } = capture();
    await auth.sendNewLogin({
      to: 'a@example.test',
      name: 'Asha',
      at,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    });
    const m = sent[0];
    expect(m?.text).toContain('14:00 IST');
    expect(m?.text).toContain('203.0.113.7');
    expect(m?.text).toContain('Mozilla/5.0 (Windows NT 10.0)');
    expect(m?.html).not.toContain('<a ');
    expect(m?.text).not.toMatch(/https?:\/\//);
  });

  it('password changed: no link', async () => {
    const { sent, auth } = capture();
    await auth.sendPasswordChanged({ to: 'a@example.test', name: 'Asha', at, ip: null });
    expect(sent[0]?.subject).toContain('password was changed');
    expect(sent[0]?.html).not.toContain('<a ');
  });

  it('escapes names and user agents in the HTML part', async () => {
    const { sent, auth } = capture();
    await auth.sendNewLogin({
      to: 'a@example.test',
      name: '<script>x</script>',
      at,
      ip: null,
      userAgent: '<img src=x onerror=alert(1)>',
    });
    expect(sent[0]?.html).not.toContain('<script>');
    expect(sent[0]?.html).not.toContain('<img');
    expect(sent[0]?.html).toContain('&lt;script&gt;');
  });
});
