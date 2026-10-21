import { expect, test } from '@playwright/test';

/**
 * M09/M10 smoke journey (doc 18 §5 routes, doc 20 screens): guard → login →
 * both screens render their header, KPI cards and toolbar, and the sidebar
 * links navigate between them. List contents are deliberately not asserted:
 * the M09/M10 API endpoints land with the backend task, so the table area may
 * honestly show a loading, empty or error state today and real rows after.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';

async function loginVia(page: import('@playwright/test').Page, nextPath: string) {
  await page.goto(nextPath);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`**${nextPath}`);
}

test('unauthenticated visitors are redirected from the customers route', async ({ page }) => {
  await page.goto('/super-admin/customers');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('super admin opens both screens from the sidebar', async ({ page }) => {
  test.setTimeout(120_000);
  await loginVia(page, '/super-admin/customers');
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await expect(page.getByText('Manage your customers and their activity.')).toBeVisible();
  await expect(page.getByText('Registered Customers')).toBeVisible();
  await expect(page.getByText('Lifetime Spend')).toBeVisible();
  await expect(page.getByText('Average Order Value')).toBeVisible();
  await expect(page.getByText('Awaiting API data').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add customer' }).first()).toBeVisible();

  // Zone dropdowns read the live GET /zones rows (no separate mock source).
  // No test-only "E2E Zone" may ever leak in (regression: zone-management
  // journey leftovers), while the seeded Tamil Nadu zones must still be offered.
  await page.getByLabel('Filter by zone').click();
  const zoneOptions = page.getByRole('option');
  await expect(zoneOptions.filter({ hasText: 'Chennai' }).first()).toBeVisible();
  await expect(zoneOptions.filter({ hasText: 'Vellore' })).toHaveCount(1);
  await expect(zoneOptions.filter({ hasText: /^E2E Zone/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Own Delivery Partners' }).click();
  await expect(page).toHaveURL(/\/super-admin\/delivery-partners/);
  await expect(
    page.getByRole('heading', { name: 'Own Delivery Partners', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Total partners')).toBeVisible();
  await expect(page.getByText('Pending Partners').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add delivery partner' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Third-Party Partners' }).click();
  await expect(page).toHaveURL(/\/super-admin\/third-party-partners/);
  await expect(
    page.getByRole('heading', { name: 'Third-Party Partners', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Total providers').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add third-party provider' }).first(),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page).toHaveURL(/\/super-admin\/customers/);
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
});
