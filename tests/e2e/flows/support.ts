import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { pickMethod, passwordStep, totpAt, typeCode, type User } from '../auth/support';

// The flows' seeded world (written by run.ts) and the steps several specs share. Sign-in, TOTP, Mailpit and axe come
// from the auth harness's helpers (they read the same E2E_STATE file: password and mailpit are in both).

export {
  axe,
  emailedCode,
  ids,
  passwordStep,
  pickMethod,
  signOut,
  typeCode,
} from '../auth/support';

interface Zone {
  id: string;
  name: string;
  code: string;
}
interface Order {
  id: string;
  no: string;
}
export const world = JSON.parse(readFileSync(process.env['E2E_STATE'] ?? '', 'utf8')) as {
  password: string;
  superAdmin: User;
  zaA: User;
  zaAB: User;
  zaNone: User;
  zoneA: Zone;
  zoneB: Zone;
  profileName: string;
  vendors: { onboard: string; homeFood: string; restaurantB: string };
  partners: { riderA: string; riderB: string };
  orders: { walk: Order; ready: Order; cancel: Order; zoneB: Order };
};

// The API refuses a TOTP step at or below the last accepted one (replay guard). Playwright restarts the worker after a
// failed test, which empties the in-memory map of ../auth/support, so the last used step per secret is kept in a file.
const stepsFile = path.join(path.dirname(process.env['E2E_STATE'] ?? '.'), 'flows-totp.json');
function lastSteps(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(stepsFile, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}
async function unusedTotp(secret: string): Promise<string> {
  for (;;) {
    const now = Math.floor(Date.now() / 30_000);
    const steps = lastSteps();
    const last = steps[secret] ?? -1;
    // the API accepts one step either side: use the next step if this one was used already
    const step = last < now ? now : last === now ? now + 1 : -1;
    if (step >= 0) {
      writeFileSync(stepsFile, JSON.stringify({ ...steps, [secret]: step }));
      return totpAt(secret, step);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function signIn(
  page: Page,
  user: User,
  tab: 'Super Admin' | 'Zonal Admin',
  landing: RegExp = tab === 'Super Admin' ? /\/super-admin\/dashboard$/ : /\/zone\/dashboard$/,
): Promise<void> {
  // the first click after a cold start can land before the form is hydrated: wait for the page, retry once
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  for (let attempt = 0; attempt < 2 && !/\/2fa$/.test(page.url()); attempt++) {
    await passwordStep(page, user.email, tab, world.password);
    await page.waitForURL(/\/2fa$/, { timeout: 10_000 }).catch(() => undefined);
  }
  await expect(page).toHaveURL(/\/2fa$/);
  await page.waitForLoadState('networkidle');
  await pickMethod(page, 'Authenticator app');
  // a code typed into a field that is not ready yet is lost: retry with the next unused step. The wait is long because a
  // slow landing (a loaded machine) would otherwise send the retry into a 2FA field that is about to go away
  for (let attempt = 0; attempt < 3; attempt++) {
    await typeCode(page, await unusedTotp(user.totpSecret ?? ''));
    const ok = await page
      .waitForURL(landing, { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    if (!/\/2fa$/.test(page.url())) break;
  }
  await expect(page).toHaveURL(landing);
}

/** axe without stopping the flow: serious findings are recorded as a soft failure (the run still reports them). */
export async function axeSoft(page: Page, what: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect
    .soft(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      `axe on ${what}`,
    )
    .toEqual([]);
}

/**
 * Confirms with the password when the API asks for a re-authentication (PASSWORD is valid 10 minutes, then not asked):
 * waits for whichever comes first, the password dialog or `done`.
 */
export async function confirmPasswordIfAsked(page: Page, done: Locator): Promise<void> {
  const reauth = page
    .getByRole('dialog')
    .filter({ hasText: 'Confirm' })
    .getByRole('textbox', { name: 'Password' });
  await expect(reauth.or(done).first()).toBeVisible({ timeout: 20_000 });
  if (await reauth.isVisible()) {
    await reauth.fill(world.password);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await expect(done.first()).toBeVisible({ timeout: 20_000 });
}

/** The status the API answers for the first request whose path ends with `pathEnd`, while `action` runs. */
export async function apiStatus(
  page: Page,
  pathEnd: string,
  action: () => Promise<unknown>,
): Promise<number> {
  const [res] = await Promise.all([
    page.waitForResponse((r) => {
      const p = new URL(r.url()).pathname;
      return p.startsWith('/api/v1/') && p.endsWith(pathEnd) && r.request().method() === 'GET';
    }),
    action(),
  ]);
  return res.status();
}
