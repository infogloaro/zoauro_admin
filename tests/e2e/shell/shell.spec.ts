import { expect, test } from '@playwright/test';

// P14 (doc 56): signed out, every protected route ends on /login with ?next= naming where the visitor wanted to go.

const cases: [string, string][] = [
  ['/', '/login'],
  ['/super-admin/zones', '/login?next=%2Fsuper-admin%2Fzones'],
  ['/super-admin/dashboard', '/login?next=%2Fsuper-admin%2Fdashboard'],
  ['/super-admin/settings/logs', '/login?next=%2Fsuper-admin%2Fsettings%2Flogs'],
  ['/zone/dashboard', '/login?next=%2Fzone%2Fdashboard'],
  ['/account/security', '/login?next=%2Faccount%2Fsecurity'],
  ['/coming-soon/orders', '/login?next=%2Fcoming-soon%2Forders'],
];

for (const [from, to] of cases) {
  test(`signed out: ${from} redirects to ${to}`, async ({ page }) => {
    const res = await page.goto(from);
    // a real HTTP redirect from the server (307), not a page that renders first and redirects in the browser
    const first = res?.request().redirectedFrom();
    expect(first?.url(), 'redirected by the server').toBe(new URL(from, page.url()).href);
    expect((await first?.response())?.status()).toBe(307);
    const url = new URL(page.url());
    expect(`${url.pathname}${url.search}`).toBe(to);
  });
}

test('an unknown route shows the 404 page', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
