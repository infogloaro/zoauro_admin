import { expect, test } from '@playwright/test';
import { signIn, signOut, world } from './support';

// Owner bug 2026-10-22: Windows / Edge in dark mode turned table headers and hovered rows black under dark text. The app
// is light only (D33): `dark:` follows a .dark class the app never sets, not prefers-color-scheme. Read only; runs
// between access-scope.spec.ts and vendors-orders.spec.ts (file order) without changing their state.

test.use({ colorScheme: 'dark' });

// light: the header is slate-100 (oklch 0.97), a hovered row the primary-soft tint (rgb 255 241 234) or transparent;
// never neutral-900 / 950 (oklch 0.2)
const LIGHT = /^(rgba\(0, 0, 0, 0\)|rgb\(2\d\d, 2\d\d, 2\d\d\)|oklch\(0\.9\d*)/;

test('dark OS: table headers and hovered rows stay light on Vendor Onboarding, Orders and Restaurants', async ({
  page,
}) => {
  await signIn(page, world.zaA, 'Zonal Admin');
  for (const path of ['/zone/vendor-onboarding', '/zone/orders', '/zone/restaurants']) {
    await page.goto(path);
    const header = page.locator('table thead th').first();
    await expect(header, path).toBeVisible();
    await expect(header, `${path} header`).toHaveCSS('background-color', LIGHT);
    const row = page.locator('table tbody tr[data-row-link]').first();
    if (await row.count()) {
      await row.hover();
      await expect(row, `${path} hovered row`).toHaveCSS('background-color', LIGHT);
    }
  }
  await signOut(page);
});
