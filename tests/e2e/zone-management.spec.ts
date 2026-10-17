import { expect, test, type Page } from '@playwright/test';

/**
 * Zone Management journey (doc 24 TC-UI-1, doc 18/20):
 * guard redirect → login → list → create → search → edit →
 * deactivate (impact-blocked) → logout → guard again.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';

const stamp = Date.now();
const zoneName = `E2E Zone ${stamp}`;
const zoneCity = 'E2E City';
const editedCity = 'E2E City Updated';

function toasts(page: Page) {
  return page.locator('[data-sonner-toast]');
}

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/super-admin/zones');
  await expect(page.getByRole('heading', { name: 'Zone Management' })).toBeVisible();
}

test('unauthenticated visitors are redirected to the login guard', async ({ page }) => {
  await page.goto('/super-admin/zones');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('super admin manages zones end to end', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Total Zones')).toBeVisible();

  // Create — Escape closes the dialog first (keyboard path), then reopen.
  await page.getByRole('button', { name: 'Add Zone' }).first().click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Add zone' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Add Zone' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#zone-name').fill(zoneName);
  await dialog.locator('#zone-city').fill(zoneCity);
  await dialog.locator('#zone-state').fill('Tamil Nadu');
  await dialog.locator('#zone-pincode-from').fill('600001');
  await dialog.locator('#zone-pincode-to').fill('600020');
  await dialog.locator('#zone-delivery-charge').fill('49');
  await dialog.getByRole('button', { name: 'Create zone' }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Zone created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(zoneName) }).first()).toBeVisible();

  // Search filters to the new zone (URL-synced q, doc 20/22).
  await page.getByLabel('Search zones').fill(zoneName);
  await expect(page).toHaveURL(/q=E2E\+Zone/);
  const rows = page.getByRole('row');
  await expect(rows).toHaveCount(2); // header + one match

  // Edit — prefilled dialog, save updates the row.
  await page.getByRole('button', { name: `Edit ${zoneName}` }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByRole('heading', { name: 'Edit zone' })).toBeVisible();
  await expect(editDialog.locator('#zone-name')).toHaveValue(zoneName);
  await editDialog.locator('#zone-city').fill(editedCity);
  await editDialog.locator('#zone-delivery-charge').fill('79');
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(editDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Zone updated' })).toBeVisible();
  await expect(page.getByRole('cell', { name: editedCity })).toBeVisible();

  // Deactivate — impact check incomplete (F1.1 pending) → 409, zone stays Active.
  await page.getByRole('button', { name: `More actions for ${zoneName}` }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const deactivateDialog = page.getByRole('dialog');
  await expect(
    deactivateDialog.getByRole('heading', { name: `Deactivate ${zoneName}?` }),
  ).toBeVisible();
  await expect(deactivateDialog.getByText('Impact check incomplete')).toBeVisible();
  await deactivateDialog.getByRole('button', { name: 'Deactivate zone' }).click();
  await expect(deactivateDialog.getByRole('alert')).toContainText('Deactivation blocked');
  await deactivateDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(deactivateDialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Active' })).toBeVisible();

  // Logout via the user menu, then the guard redirects again.
  await page.locator('header button:not([aria-label])').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/super-admin/zones');
  await expect(page).toHaveURL(/\/login\?next=/);
});
