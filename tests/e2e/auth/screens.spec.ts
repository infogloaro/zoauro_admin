import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { axe, freshTotp, signInWithAuthenticator, signOut, state } from './support';

// The themed shell and the live screens after sign-in (owner's prototype theme + roadmap navigation): both roles'
// dashboards, Recent Activities, Settings > Security with a real STRONG-confirmed save, a module plan page, the page
// finder and the folding menu. axe on every screen; full-page screenshots go to tests/e2e/.state/screens (git-ignored)
// for a visual check.

const shots = path.resolve(__dirname, '../.state/screens');
mkdirSync(shots, { recursive: true });

async function look(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await axe(page, name);
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

test.use({ viewport: { width: 1440, height: 900 } });

test('Super Admin: dashboard, Recent Activities, Security settings save (STRONG), a module plan, page finder, folding menu', async ({
  page,
}) => {
  const sa = state.superAdmin;
  await signInWithAuthenticator(page, sa, 'Super Admin');
  await expect(page).toHaveURL(/\/super-admin\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening),/,
  );
  // real figures: the run created one zone; no invented numbers
  await expect(page.getByRole('link', { name: /Total zones/ })).toContainText('1');
  await expect(page.getByRole('heading', { name: 'Security status' })).toBeVisible();
  await look(page, 'sa-dashboard');

  // grouped menu: a Soon entry and a live one
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(
    nav.getByRole('link', { name: 'Restaurant Onboarding (coming soon)' }),
  ).toBeVisible();
  await nav.getByRole('link', { name: 'Recent Activities' }).click();
  await expect(page).toHaveURL(/\/super-admin\/activity$/);
  await expect(page.getByRole('heading', { name: 'Recent Activities', level: 1 })).toBeVisible();
  await look(page, 'sa-recent-activities');

  // the page finder: Ctrl+K, type, Enter
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Find a page' })).toBeFocused();
  await page.keyboard.type('security set');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/super-admin\/settings\/security$/);
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  await look(page, 'sa-security-settings');

  // change a harmless value, save, confirm with password + authenticator code (STRONG)
  const ttl = page.getByLabel('Code valid for');
  await ttl.fill('240');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Password' }).fill(state.password);
  await dialog.getByLabel('6-digit code').fill(await freshTotp(sa.totpSecret ?? ''));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Security policy saved').first()).toBeAttached();
  await page.reload();
  await expect(page.getByLabel('Code valid for')).toHaveValue('240');

  // a module that is not built yet: its plan, never data
  await page.goto('/coming-soon/restaurant-requests');
  await expect(
    page.getByRole('heading', { name: 'Restaurant Onboarding', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Planned screens/ })).toBeVisible();
  await expect(page.getByText('More Information Required')).toBeVisible();
  await look(page, 'sa-plan-restaurant-onboarding');

  // the menu folds to an icon rail and is remembered
  await page.getByRole('button', { name: 'Collapse the menu' }).click();
  await expect(page.getByRole('button', { name: 'Expand the menu' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/super-admin/dashboard');
  await expect(page.getByRole('button', { name: 'Expand the menu' })).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'sa-dashboard-rail.png') });
  await page.getByRole('button', { name: 'Expand the menu' }).click();

  await signOut(page);
});

test('Zonal Admin: own dashboard from /me, Access Requests plan, no Super Admin pages', async ({
  page,
}) => {
  await signInWithAuthenticator(page, state.zonalAdmin, 'Zonal Admin');
  await expect(page).toHaveURL(/\/zone\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening),/,
  );
  await expect(page.getByText('What I can do here').first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /Zone Management/ })).toHaveCount(0);
  await look(page, 'za-dashboard');

  await nav.getByRole('link', { name: 'Access Requests (coming soon)' }).click();
  await expect(page).toHaveURL(/\/coming-soon\/access-requests$/);
  await expect(page.getByText('Nobody can approve their own request')).toBeVisible();
  await look(page, 'za-plan-access-requests');

  // a Super Admin page does not exist for a Zonal Admin (404), and neither does a hidden module's plan
  const sa = await page.goto('/super-admin/settings/security');
  expect(sa?.status()).toBe(404);
  // the (member) area streams (loading.tsx), so this 404 page arrives with HTTP 200: check what is shown
  await page.goto('/coming-soon/hotel-booking');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByText('Hotel Room Booking')).toHaveCount(0);

  await page.goto('/zone/dashboard');
  await signOut(page);
});
