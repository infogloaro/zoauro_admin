import { expect, test, type Page } from '@playwright/test';

/**
 * A6 CSV menu import journey (doc 34 SA-2.5, Figma "Import" button, doc 44
 * §5 dry-run → report → confirm): login → restaurant create → Menu & Food
 * Items → Import CSV → dry-run report writes nothing → confirm import →
 * items land Pending and are searchable → re-running the same file reports
 * every row as a duplicate and the import button stays disabled.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';

const stamp = Date.now();
const restaurantName = `Import Dhaba ${stamp}`;
const restaurantPhone = `7${String(stamp).slice(-9)}`;
const itemNameA = `E2E Import Dosa ${stamp}`;
const itemNameB = `E2E Import Idli ${stamp}`;
const categoryA = `Import Cat A ${stamp}`;
const categoryB = `Import Cat B ${stamp}`;

const CSV_HEADER = 'zone,provider,type,name,description,category,price,dietary';
const csv = [
  CSV_HEADER,
  `Chennai,${restaurantName},restaurant,${itemNameA},Crisp dosa,${categoryA},120,VEGETARIAN`,
  `Chennai,${restaurantName},restaurant,${itemNameB},Soft idli,${categoryB},90,VEGETARIAN`,
].join('\n');

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

test('super admin imports a menu CSV end to end with a dry run first', async ({ page }) => {
  test.setTimeout(180_000);

  // Restaurant create — the CSV references this provider by name.
  await loginVia(page, '/super-admin/restaurants');
  await page.getByRole('button', { name: 'Add Restaurant' }).first().click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog.getByRole('heading', { name: 'Add restaurant' })).toBeVisible();
  await createDialog.locator('#vendor-zone').click();
  await page.getByRole('option', { name: 'Chennai', exact: true }).click();
  await createDialog.locator('#vendor-name').fill(restaurantName);
  await createDialog.locator('#vendor-owner').fill('Import Owner');
  await createDialog.locator('#vendor-phone').fill(restaurantPhone);
  await createDialog.locator('#vendor-address').fill('5, Mount Poonamallee Road');
  await createDialog.locator('#vendor-area').fill('Porur');
  await createDialog.locator('#vendor-cuisines').fill('South Indian');
  await createDialog.getByRole('button', { name: 'Create restaurant' }).click();
  await expect(createDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Restaurant created' })).toBeVisible();

  // Menu & Food Items screen and the Import dialog.
  await page.goto('/super-admin/menu-items');
  await expect(page.getByRole('heading', { name: 'Menu & Food Items' })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const importDialog = page.getByRole('dialog');
  await expect(importDialog.getByRole('heading', { name: 'Import menu items' })).toBeVisible();
  await expect(importDialog.getByText('zone, provider, type, name,')).toBeVisible();

  // Dry run: the report appears, nothing is on the menu yet.
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: 'menu-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const report = importDialog.getByTestId('import-report');
  await expect(report).toContainText('Dry run: 2 of 2 rows will be imported');
  await expect(report).toContainText('0 with errors');
  await expect(importDialog.getByText(itemNameA)).toHaveCount(0);

  // Confirm — items are created and land Pending.
  await importDialog.getByRole('button', { name: /^Import 2 items$/ }).click();
  await expect(importDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: '2 items imported' }).first()).toBeVisible();

  await page.getByLabel('Search menu items').fill(itemNameA);
  await expect(page.getByRole('cell', { name: new RegExp(itemNameA) }).first()).toBeVisible();
  await expect(page.getByText('Pending').first()).toBeVisible();
  await page.getByLabel('Search menu items').fill(itemNameB);
  await expect(page.getByRole('cell', { name: new RegExp(itemNameB) }).first()).toBeVisible();

  // Re-running the same file reports duplicates and offers nothing to import.
  await page.getByLabel('Search menu items').fill('');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: 'menu-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(report).toContainText(
    'Dry run: 0 of 2 rows will be imported, 0 need fixing, 2 already',
  );
  await expect(importDialog.getByRole('button', { name: /^Import 0 items$/ })).toBeDisabled();
  await importDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(importDialog).toBeHidden();
});
