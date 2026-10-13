import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Shared helpers of the e2e suites run by run.ts: the run's users, a test-only TOTP generator, Mailpit, axe and the
// sign-in steps. Codes come from Mailpit or the TOTP generator; none is printed.

export interface User {
  email: string;
  totpSecret?: string;
}
export const state = JSON.parse(readFileSync(process.env['E2E_STATE'] ?? '', 'utf8')) as {
  password: string;
  mailpit: string;
  superNew: User;
  zonalNew: User;
  superAdmin: User;
  zonalAdmin: User;
  locked: User;
  resetter: User;
  firstLogin: User;
};
export const GENERIC = 'The email or password is not correct.';

// ---- test-only TOTP generator (RFC 6238: SHA-1, 6 digits, 30 s) -------------------------------------------------------

export function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/[\s=]/g, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}
/** A code the API has not seen yet: it refuses a step at or below the last accepted one (replay guard, TC-AUTH-11). */
export const usedStep = new Map<string, number>();
export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const now = Math.floor(Date.now() / 30_000);
    const last = usedStep.get(secret) ?? -1;
    // the API accepts one step either side: use the next step if this one was used already
    const step = last < now ? now : last === now ? now + 1 : -1;
    if (step >= 0) {
      usedStep.set(secret, step);
      return totpAt(secret, step);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---- Mailpit ----------------------------------------------------------------------------------------------------------

export interface MailSummary {
  ID: string;
  Subject: string;
}
export async function mails(to: string): Promise<MailSummary[]> {
  const res = await fetch(
    `${state.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
  );
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}
/** Waits for a message to `to` that was not in `before`, matching `subject`. */
export async function nextMail(
  to: string,
  before: readonly string[],
  subject: RegExp,
): Promise<MailSummary> {
  const until = Date.now() + 20_000;
  for (;;) {
    const m = (await mails(to)).find((x) => !before.includes(x.ID) && subject.test(x.Subject));
    if (m) return m;
    if (Date.now() > until) throw new Error(`no new mail "${subject}" to ${to}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
export const ids = async (to: string) => (await mails(to)).map((m) => m.ID);
export const CODE_SUBJECT = /^(\d{6}) is your ZOAURO Admin/;
export async function emailedCode(to: string, before: readonly string[]): Promise<string> {
  const m = await nextMail(to, before, CODE_SUBJECT);
  return CODE_SUBJECT.exec(m.Subject)?.[1] ?? '';
}

// ---- page helpers -----------------------------------------------------------------------------------------------------

export async function axe(page: Page, what: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    `axe on ${what}`,
  ).toEqual([]);
}

export async function passwordStep(
  page: Page,
  email: string,
  tab: 'Super Admin' | 'Zonal Admin',
  password = state.password,
) {
  await page.goto('/login');
  await page.getByText(tab, { exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function typeCode(
  page: Page,
  code: string,
  name = 'Verification code',
): Promise<void> {
  await page.getByRole('textbox', { name: `${name}, digit 1 of 6` }).click();
  await page.keyboard.type(code);
}

export async function signInWithAuthenticator(
  page: Page,
  user: User,
  tab: 'Super Admin' | 'Zonal Admin',
) {
  await passwordStep(page, user.email, tab);
  await expect(page).toHaveURL(/\/2fa$/);
  await typeCode(page, await freshTotp(user.totpSecret ?? ''));
}

export async function signOut(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /Super Admin|Zonal Admin/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}
