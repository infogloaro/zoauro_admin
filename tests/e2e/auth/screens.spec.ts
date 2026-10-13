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

/** Confirms with the password when the API asks for a re-authentication (PASSWORD is valid 10 minutes, then not asked). */
async function confirmPasswordIfAsked(page: Page): Promise<void> {
  const reauth = page
    .getByRole('dialog')
    .filter({ hasText: 'Confirm' })
    .getByRole('textbox', { name: 'Password' });
  if (await reauth.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await reauth.fill(state.password);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
}

test('Zone Management (TC-ZONE-28/29): overlap caught live and on save, create, activate, deactivate with impact, pincodes preview, activity', async ({
  page,
}) => {
  await signInWithAuthenticator(page, state.superAdmin, 'Super Admin');
  await expect(page).toHaveURL(/\/super-admin\/dashboard$/);
  await page.goto('/super-admin/zones');
  await expect(page.getByRole('heading', { name: 'Zone Management', level: 1 })).toBeVisible();
  await look(page, 'sa-zones-list');

  // zone A owns 600090
  await page.getByRole('button', { name: 'Add zone' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Zone name').fill('E2E Adyar');
  await form.getByLabel('Zone code').fill('EADY');
  await form.getByLabel('City').fill('Chennai');
  await form.getByLabel('State').fill('Tamil Nadu');
  await form.getByLabel('Default delivery charge (₹)').fill('25');
  await form.getByLabel('Add individual pincodes').fill('600090');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await look(page, 'sa-zone-form');
  await form.getByRole('button', { name: 'Create zone' }).click();
  await expect(page).toHaveURL(/\/super-admin\/zones\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'E2E Adyar', level: 1 })).toBeVisible();

  // zone B asks for the same pincode: flagged while typing, refused on save; fixed, then created
  await page.goto('/super-admin/zones?new=1');
  const b = page.getByRole('dialog');
  await b.getByLabel('Zone name').fill('E2E Velachery');
  await b.getByLabel('Zone code').fill('EVEL');
  await b.getByLabel('City').fill('Chennai');
  await b.getByLabel('State').fill('Tamil Nadu');
  await b.getByLabel('Default delivery charge (₹)').fill('30');
  await b.getByLabel('Add individual pincodes').fill('600090 600091');
  await b.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(b.getByText('in E2E Adyar')).toBeVisible();
  await b.getByRole('button', { name: 'Create zone' }).click();
  await expect(b.getByRole('alert')).toContainText('belong to another zone');
  await b.getByRole('button', { name: 'Remove 600090' }).click();
  await b.getByRole('button', { name: 'Create zone' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Velachery', level: 1 })).toBeVisible();
  await expect(page.getByText('Upcoming').first()).toBeVisible();
  await look(page, 'sa-zone-detail-overview');

  // activate (password confirmation)
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByRole('button', { name: 'Activate zone' }).click();
  await confirmPasswordIfAsked(page);
  await expect(page.getByText('E2E Velachery is live').first()).toBeAttached();
  await expect(page.getByRole('button', { name: 'Deactivate' })).toBeVisible();

  // deactivate: impact table, reason, acknowledgement
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('rowheader', { name: 'Open orders' })).toBeVisible();
  await expect(d.getByText(/Some modules are not built yet/)).toBeVisible();
  await look(page, 'sa-zone-deactivate');
  await d.getByLabel('Reason').fill('Road works on the main street');
  await d.getByLabel(/I understand open orders will continue/).check();
  await d.getByRole('button', { name: 'Deactivate zone' }).click();
  await confirmPasswordIfAsked(page);
  await expect(page.getByText(/Paused/).first()).toBeVisible();

  // pincodes: preview then save
  await page.getByRole('tab', { name: 'Pincodes' }).click();
  await page.getByLabel('Pincodes to add').fill('600092');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('+1 added:')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('cell', { name: '600092' })).toBeVisible();
  await look(page, 'sa-zone-detail-pincodes');

  // activity: the changes made above are in the audit trail
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText(/Deactivated zone|zone.deactivated/i).first()).toBeVisible();
  await look(page, 'sa-zone-detail-activity');

  await page.getByRole('tab', { name: 'Team' }).click();
  await look(page, 'sa-zone-detail-team');

  // P17: System Logs inside the shell (one main landmark), with the zone just created in its rows; the Sign-ins tab
  await page.goto('/super-admin/settings/logs');
  await expect(page.getByRole('heading', { name: 'System Logs', level: 1 })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'E2E Velachery' }).first()).toBeVisible();
  await look(page, 'sa-system-logs');
  await page.getByRole('tab', { name: 'Sign-ins' }).click();
  await look(page, 'sa-system-logs-signins');
  await signOut(page);
});
