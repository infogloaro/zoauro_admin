import { expect, test } from '@playwright/test';
import { signIn, signOut, world } from './support';

// Owner bug 2026-10-22: Windows / Edge in dark mode turned table headers and hovered rows black under dark text. The app
// is light only (D33): `dark:` follows a .dark class the app never sets, not prefers-color-scheme. Read only; runs
// between access-scope.spec.ts and vendors-orders.spec.ts (file order) without changing their state.

test.use({ colorScheme: 'dark' });

// bg-white; a hovered row is hover:bg-neutral-50 (oklch 0.985) or transparent, never neutral-900 / 950 (oklch 0.2)
const WHITE = 'rgb(255, 255, 255)';
const LIGHT_OR_NONE = /^(rgba\(0, 0, 0, 0\)|rgb\(2[4-5]\d, 2[4-5]\d, 2[4-5]\d\)|oklch\(0\.9\d*)/;

test('dark OS: table headers and hovered rows stay light on Vendor Onboarding, Orders and Restaurants', async ({
  page,
}) => {
  await signIn(page, world.zaA, 'Zonal Admin');
  for (const path of ['/zone/vendor-onboarding', '/zone/orders', '/zone/restaurants']) {
    await page.goto(path);
    const header = page.locator('table thead th').first();
    await expect(header, path).toBeVisible();
    await expect(header, `${path} header`).toHaveCSS('background-color', WHITE);
    const row = page.locator('table tbody tr[data-row-link]').first();
    if (await row.count()) {
      await row.hover();
      await expect(row, `${path} hovered row`).toHaveCSS('background-color', LIGHT_OR_NONE);
    }
  }
  await signOut(page);
});
