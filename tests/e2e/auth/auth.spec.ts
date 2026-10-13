import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// P15 against the real stack (doc 52 TC-AUTH-45, 46, 47 and doc 56 P15 "Expected"): sign in, the second step by
// authenticator and by email code, the first-time set-up wizard, logout, the lock, forgot/reset password, the forced
// password change, Account security, and axe on every screen. Codes come from Mailpit or a test-only TOTP generator;
// none is printed.

interface User {
  email: string;
  totpSecret?: string;
}
const state = JSON.parse(readFileSync(process.env['E2E_STATE'] ?? '', 'utf8')) as {
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
const GENERIC = 'The email or password is not correct.';

// ---- test-only TOTP generator (RFC 6238: SHA-1, 6 digits, 30 s) -------------------------------------------------------

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/[\s=]/g, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}
/** A code the API has not seen yet: it refuses a step at or below the last accepted one (replay guard, TC-AUTH-11). */
const usedStep = new Map<string, number>();
async function freshTotp(secret: string): Promise<string> {
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

interface MailSummary {
  ID: string;
  Subject: string;
}
async function mails(to: string): Promise<MailSummary[]> {
  const res = await fetch(
    `${state.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
  );
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}
/** Waits for a message to `to` that was not in `before`, matching `subject`. */
async function nextMail(
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
const ids = async (to: string) => (await mails(to)).map((m) => m.ID);
const CODE_SUBJECT = /^(\d{6}) is your ZOAURO Admin/;
async function emailedCode(to: string, before: readonly string[]): Promise<string> {
  const m = await nextMail(to, before, CODE_SUBJECT);
  return CODE_SUBJECT.exec(m.Subject)?.[1] ?? '';
}

// ---- page helpers -----------------------------------------------------------------------------------------------------

async function axe(page: Page, what: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    `axe on ${what}`,
  ).toEqual([]);
}

async function passwordStep(
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

async function typeCode(page: Page, code: string, name = 'Verification code'): Promise<void> {
  await page.getByRole('textbox', { name: `${name}, digit 1 of 6` }).click();
  await page.keyboard.type(code);
}

async function signInWithAuthenticator(page: Page, user: User, tab: 'Super Admin' | 'Zonal Admin') {
  await passwordStep(page, user.email, tab);
  await expect(page).toHaveURL(/\/2fa$/);
  await typeCode(page, await freshTotp(user.totpSecret ?? ''));
}

async function signOut(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /Super Admin|Zonal Admin/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// ---- tests ------------------------------------------------------------------------------------------------------------

test('login screen: axe, wrong tab and wrong password give the same message', async ({ page }) => {
  await page.goto('/login');
  await axe(page, '/login');
  await passwordStep(page, state.superAdmin.email, 'Zonal Admin'); // right password, wrong tab
  await expect(page.locator('main').getByRole('alert')).toHaveText(GENERIC);
  await passwordStep(page, state.superAdmin.email, 'Super Admin', 'not-the-password-1');
  await expect(page.locator('main').getByRole('alert')).toHaveText(GENERIC);
  await page.goto('/forgot-password');
  await axe(page, '/forgot-password');
});

test('TC-AUTH-46: a new Super Admin sets up an authenticator in the wizard and lands on the dashboard', async ({
  page,
}) => {
  const u = state.superNew;
  await passwordStep(page, u.email, 'Super Admin');
  await expect(page).toHaveURL(/\/2fa\/setup$/);
  await expect(page.getByRole('heading', { name: 'Set up 2-step verification' })).toBeVisible();
  await axe(page, '/2fa/setup (email step)');

  // 1. the mailbox proof
  const before = await ids(u.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await typeCode(page, await emailedCode(u.email, before));

  // 2. the authenticator: the key shown on the screen feeds the test TOTP generator
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await axe(page, '/2fa/setup (authenticator)');
  const key = ((await page.locator('code').textContent()) ?? '').replace(/\s/g, '');
  expect(key).toMatch(/^[A-Z2-7]{16,}$/);
  await typeCode(page, await freshTotp(key), 'Code from the app');
  await expect(page.getByText('Added')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // 3. backup codes, acknowledged
  await expect(page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')).toHaveCount(
    10,
  );
  await axe(page, '/2fa/setup (backup codes)');
  const finish = page.getByRole('button', { name: 'Finish and sign in' });
  await expect(finish).toBeDisabled();
  await page.getByLabel('I have saved these codes').check();
  await finish.click();
  await expect(page).toHaveURL(/\/super-admin\/dashboard$/);

  // the next sign-in asks for the authenticator
  await signOut(page);
  await passwordStep(page, u.email, 'Super Admin');
  await expect(page).toHaveURL(/\/2fa$/);
  await typeCode(page, await freshTotp(key));
  await expect(page).toHaveURL(/\/super-admin\/dashboard$/);
});

test('TC-AUTH-45: a Zonal Admin enrols email codes and signs in with an emailed code', async ({
  page,
}) => {
  const u = state.zonalNew;
  await passwordStep(page, u.email, 'Zonal Admin');
  await expect(page).toHaveURL(/\/2fa\/setup$/);
  let before = await ids(u.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await typeCode(page, await emailedCode(u.email, before));
  // email is allowed for Zonal Admins: confirming the mailbox enrolled it
  await expect(page.getByRole('heading', { name: 'Add a method' })).toBeVisible();
  await expect(page.getByText('Added')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('I have saved these codes').check();
  await page.getByRole('button', { name: 'Finish and sign in' }).click();
  await expect(page).toHaveURL(/\/zone\/dashboard$/);

  await signOut(page);
  before = await ids(u.email);
  await passwordStep(page, u.email, 'Zonal Admin');
  await expect(page).toHaveURL(/\/2fa$/);
  await expect(page.getByText(/We sent a code to/)).toBeVisible(); // sent when the method is shown
  await axe(page, '/2fa (email code)');
  await typeCode(page, await emailedCode(u.email, before));
  await expect(page).toHaveURL(/\/zone\/dashboard$/);
});

test('keyboard only: sign in, second step, the shell, Account security (axe), logout ends the session', async ({
  page,
}) => {
  const u = state.superAdmin;
  await page.goto('/login?next=%2Faccount%2Fsecurity');
  // Tab from the top of the page to the email field, then type everything; Enter submits
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.getByLabel('Email').evaluate((el) => el.matches(':focus'))) break;
  }
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(u.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(state.password);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/2fa$/);
  // the first cell has focus: just type, the sixth digit submits
  await expect(
    page.getByRole('textbox', { name: 'Verification code, digit 1 of 6' }),
  ).toBeFocused();
  await axe(page, '/2fa (authenticator)');
  await page.keyboard.type(await freshTotp(u.totpSecret ?? ''));
  await expect(page).toHaveURL(/\/account\/security$/);

  await expect(page.getByRole('heading', { name: 'Account security' })).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Recent sign-ins' }).getByRole('row'),
  ).not.toHaveCount(0);
  await axe(page, '/account/security');

  await signOut(page);
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await page.goto('/super-admin/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fsuper-admin%2Fdashboard$/);
});

test('five wrong passwords lock the account: the right password then gets the same message and the lock rule', async ({
  page,
}) => {
  const u = state.locked;
  for (let i = 0; i < 5; i += 1) {
    await passwordStep(page, u.email, 'Zonal Admin', `wrong-password-${i}`);
    await expect(page.locator('main').getByRole('alert')).toContainText(GENERIC);
  }
  // one page, several failures: the rule is explained
  await page.getByLabel('Password', { exact: true }).fill(state.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(GENERIC);
  await expect(page.locator('main').getByRole('alert')).toContainText('locked for 30 minutes');
  await expect(page).toHaveURL(/\/login$/);
});

test('forgot password: the email arrives in Mailpit, the link resets the password, the second step still applies', async ({
  page,
}) => {
  const u = state.resetter;
  const before = await ids(u.email);
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(u.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If that email belongs to an account');

  const mail = await nextMail(u.email, before, /reset/i);
  const body = (await (await fetch(`${state.mailpit}/api/v1/message/${mail.ID}`)).json()) as {
    Text: string;
  };
  const link = /(https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9_\-%]+)/.exec(body.Text)?.[1];
  expect(link, 'reset link in the email').toBeTruthy();
  await page.goto(link ?? '');
  await axe(page, '/reset-password');
  const fresh = 'violet-harbour-lantern-42';
  await page.getByLabel('New password', { exact: true }).fill(fresh);
  await page.getByLabel('Repeat the new password').fill(fresh);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

  // the link works once
  await page.goto(link ?? '');
  await page.getByLabel('New password', { exact: true }).fill('another-harbour-lantern-43');
  await page.getByLabel('Repeat the new password').fill('another-harbour-lantern-43');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'expired or was already used',
  );

  await passwordStep(page, u.email, 'Zonal Admin', fresh);
  await expect(page).toHaveURL(/\/2fa$/); // D76: a reset does not skip the second step
});

test('first sign-in with a temporary password: second step, then the forced change, then the dashboard', async ({
  page,
}) => {
  const u = state.firstLogin;
  await signInWithAuthenticator(page, u, 'Super Admin');
  await expect(page).toHaveURL(/\/change-password$/);
  await axe(page, '/change-password');
  // the shell is closed until the password is changed
  await page.goto('/super-admin/dashboard');
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Current password', { exact: true }).fill(state.password);
  await page.getByLabel('New password', { exact: true }).fill('saffron-meadow-compass-17');
  await page.getByLabel('Repeat the new password').fill('saffron-meadow-compass-17');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/super-admin\/dashboard$/);
});

test('a Zonal Admin signs in with the authenticator and reaches their own Account security', async ({
  page,
}) => {
  await signInWithAuthenticator(page, state.zonalAdmin, 'Zonal Admin');
  await expect(page).toHaveURL(/\/zone\/dashboard$/);
  await page.getByRole('button', { name: /Zonal Admin/ }).click();
  await page.locator('header').getByRole('link', { name: 'Account security' }).click();
  await expect(page.getByRole('heading', { name: 'Account security' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Two-step verification' })).toContainText(
    'Authenticator app',
  );
  await axe(page, '/account/security (Zonal Admin)');
});
