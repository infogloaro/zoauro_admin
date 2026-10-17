import { expect, test, type Page } from '@playwright/test';

/**
 * M06/M07 journey (doc 24 TC-UI-2/TC-UI-3, doc 18 §5 routes, doc 20/21/22):
 * guard → login → restaurant create (zone, area) → tab walk between the two
 * canonical routes → homemaker create → detail reveal → opening-hours edit →
 * SA-2.1 documents (presigned upload, signed view, verify).
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';

const stamp = Date.now();
const restaurantName = `Chennai ${stamp}`;
const homemakerName = `Cloud Kitchen ${stamp}`;

function toasts(page: Page) {
  return page.locator('[data-sonner-toast]');
}

async function loginVia(page: Page, nextPath: string) {
  await page.goto(nextPath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`**${nextPath}`);
}

async function pickZone(page: Page, zoneName: string) {
  await page.getByRole('dialog').locator('#vendor-zone').click();
  await page.getByRole('option', { name: zoneName, exact: true }).click();
}

test('unauthenticated visitors are redirected from the homemakers route', async ({ page }) => {
  await page.goto('/super-admin/homemakers');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('super admin manages restaurants and homemakers end to end', async ({ page }) => {
  test.setTimeout(120_000);
  await loginVia(page, '/super-admin/restaurants');
  await expect(page.getByRole('heading', { name: 'Restaurant Management' })).toBeVisible();
  await expect(page.getByText('Registered Restaurants')).toBeVisible();

  // Restaurant create — zone, identity and area all persist (doc 22).
  await page.getByRole('button', { name: 'Add Restaurant' }).first().click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog.getByRole('heading', { name: 'Add restaurant' })).toBeVisible();
  await pickZone(page, 'Chennai');
  await createDialog.locator('#vendor-name').fill(restaurantName);
  await createDialog.locator('#vendor-owner').fill('Ravi Kumar');
  await createDialog.locator('#vendor-phone').fill('9876543210');
  await createDialog.locator('#vendor-email').fill('ravi@example.com');
  await createDialog.locator('#vendor-address').fill('12, 2nd Avenue');
  await createDialog.locator('#vendor-area').fill('Tambaram');
  await createDialog.locator('#vendor-cuisines').fill('Biryani, Chinese');
  await createDialog.getByRole('button', { name: 'Create restaurant' }).click();
  await expect(createDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Restaurant created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(restaurantName) }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Chennai/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Gross value' })).toBeVisible();

  // Search narrows to the new row (URL-synced q, doc 20/22).
  await page.getByLabel('Search restaurants').fill(restaurantName);
  await expect(page).toHaveURL(/q=E2E/);
  await expect(page.getByRole('row')).toHaveCount(2); // header + one match
  await page.getByLabel('Search restaurants').fill('');
  await expect(page).not.toHaveURL(/q=/); // debounce committed the clear

  // Tab walk goes to the canonical sibling route (doc 18 §5) via the sidebar
  // (the reference screens navigate kinds through Service Management links).
  await page.getByRole('link', { name: 'Home Food', exact: true }).click();
  await page.waitForURL('**/super-admin/homemakers');
  await expect(page.getByRole('heading', { name: 'Home Food Management' })).toBeVisible();
  await expect(page.getByText('Registered Providers')).toBeVisible();

  // Homemaker create with its own kind-specific fields (doc 21/22).
  await page.getByRole('button', { name: 'Add Provider' }).first().click();
  const homemakerDialog = page.getByRole('dialog');
  await expect(homemakerDialog.getByRole('heading', { name: 'Add homemaker' })).toBeVisible();
  await pickZone(page, 'Chennai');
  await homemakerDialog.locator('#vendor-name').fill(homemakerName);
  await homemakerDialog.locator('#vendor-phone').fill('9812345678');
  await homemakerDialog.locator('#vendor-address').fill('4, Cross Street');
  await homemakerDialog.locator('#vendor-area').fill('Vadapalani');
  await homemakerDialog.locator('#vendor-speciality').fill('Tiffin, Snacks');
  await homemakerDialog.getByRole('button', { name: 'Create homemaker' }).click();
  await expect(homemakerDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Homemaker created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(homemakerName) }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Chennai/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Gross value' })).toBeVisible();

  // Walk back — the Restaurants link returns to its own route.
  await page.getByRole('link', { name: 'Restaurants', exact: true }).click();
  await page.waitForURL('**/super-admin/restaurants');

  // Detail view reveals the full contact (doc 15: reveal on detail).
  await page.getByLabel('Search restaurants').fill(restaurantName);
  await expect(page).toHaveURL(/q=E2E/);
  await page
    .getByRole('row', { name: new RegExp(restaurantName) })
    .getByRole('button', { name: 'View', exact: true })
    .click();
  await expect(page).toHaveURL(/vendor=/);
  const detail = page.getByRole('dialog');
  // The dialog title also carries the verification/status badges.
  await expect(detail.getByRole('heading', { name: new RegExp(restaurantName) })).toBeVisible();
  await expect(detail.getByText('9876543210')).toBeVisible();

  // Opening-hours editor (doc 22 form field, doc 39 W4 "Hours set").
  await detail.getByRole('tab', { name: 'Commission & hours' }).click();
  await expect(detail.getByText('Opening hours are not set yet.')).toBeVisible();
  await detail.getByRole('button', { name: 'Edit hours' }).click();
  await detail.getByRole('switch', { name: 'Open on MON' }).click();
  await detail.getByRole('button', { name: 'Save hours' }).click();
  await expect(toasts(page).filter({ hasText: 'Opening hours saved' })).toBeVisible();
  await expect(detail.getByText('09:00 – 22:00').first()).toBeVisible();

  // Documents tab (SA-2.1, docs 11/22): presigned upload against MinIO,
  // then the private file is readable only through the signed viewer.
  await detail.getByRole('tab', { name: 'Documents' }).click();
  await detail.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/fssai.png');
  await expect(toasts(page).filter({ hasText: 'FSSAI document uploaded' })).toBeVisible();
  const fssaiRow = detail.locator('li').filter({ hasText: 'FSSAI' });
  await expect(fssaiRow).toBeVisible();
  await expect(fssaiRow.getByText('Pending')).toBeVisible();

  await fssaiRow.getByRole('button', { name: 'View' }).click();
  const viewer = page.getByRole('dialog').filter({ hasText: 'FSSAI document' });
  await expect(viewer.getByRole('img')).toBeVisible();
  await viewer.locator('button').filter({ hasText: 'Close' }).click();
  await expect(viewer).toBeHidden();

  // Verify (note optional) flips the row badge through the audit path.
  await fssaiRow.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'Verify document' }).click();
  await expect(toasts(page).filter({ hasText: 'FSSAI document verified' })).toBeVisible();
  await expect(fssaiRow.getByText('Verified')).toBeVisible();
});
