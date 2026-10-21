import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Zone Management journey (doc 24 TC-UI-1, doc 18/20):
 * guard redirect → login → list → create → search → edit →
 * deactivate (impact-blocked) → cleanup → logout → guard again.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';

const stamp = Date.now();
const zoneName = `E2E Zone ${stamp}`;
const zoneCity = 'E2E City';
const editedCity = 'E2E City Updated';

/**
 * This journey creates a zone in the database the API serves (the dev
 * database unless DATABASE_URL says otherwise, TD-23). The product API cannot
 * remove one yet — DELETE /zones/{id} deactivates and the impact check is
 * deliberately incomplete until F1.1 (409) — so a zone left behind would sit
 * in the database forever and appear in every Zone dropdown (they read
 * GET /zones). Test hygiene: delete exactly this run's row, by its unique
 * name, right after the journey — never any other zone.
 */
async function deleteJourneyZone(name: string): Promise<number> {
  if (!process.env.DATABASE_URL) {
    // Same fallback the API process uses (TD-23).
    process.loadEnvFile(path.resolve(process.cwd(), 'apps/api/.env'));
  }
  // The generated Prisma client lives in apps/api; resolve it from there.
  const requireFromApi = createRequire(path.resolve(process.cwd(), 'apps/api/package.json'));
  const { PrismaClient } = requireFromApi('@prisma/client') as {
    PrismaClient: new () => {
      zone: {
        findMany: (args: {
          where: { name: string };
          select: { id: true };
        }) => Promise<Array<{ id: string }>>;
        deleteMany: (args: { where: { name: string } }) => Promise<{ count: number }>;
      };
      auditLog: {
        deleteMany: (args: { where: { zoneId: { in: string[] } } }) => Promise<{ count: number }>;
      };
      $disconnect: () => Promise<void>;
    };
  };
  const prisma = new PrismaClient();
  try {
    const zones = await prisma.zone.findMany({ where: { name }, select: { id: true } });
    if (zones.length === 0) return 0;
    await prisma.auditLog.deleteMany({ where: { zoneId: { in: zones.map((z) => z.id) } } });
    const deleted = await prisma.zone.deleteMany({ where: { name } });
    return deleted.count;
  } finally {
    await prisma.$disconnect();
  }
}

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
  test.setTimeout(90_000);
  try {
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
  } finally {
    // Runs on success and on failure — the journey's zone must not outlive
    // the test run, or it leaks into every Zone dropdown (they read GET /zones).
    await deleteJourneyZone(zoneName);
  }

  // Regression guard: the zone this journey created is gone from the source
  // every dropdown reads (GET /zones), while the session is still open.
  const remaining = await page.request.get(`/api/v1/zones?q=${encodeURIComponent(zoneName)}`);
  expect(remaining.ok()).toBe(true);
  const remainingBody = (await remaining.json()) as { data: Array<{ name: string }> };
  expect(remainingBody.data.filter((zone) => zone.name === zoneName)).toHaveLength(0);

  // Logout via the user menu, then the guard redirects again.
  await page.locator('header button:not([aria-label])').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/super-admin/zones');
  await expect(page).toHaveURL(/\/login\?next=/);
});
