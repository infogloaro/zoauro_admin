import { expect, test, type Page } from '@playwright/test';
import {
  apiStatus,
  axe,
  confirmPasswordIfAsked,
  emailedCode,
  ids,
  passwordStep,
  pickMethod,
  signIn,
  signOut,
  typeCode,
  world,
} from './support';

// Flow 1-4 (QA, 2026-10-18): who sees what. The Super Admin creates a zone and a Zonal Admin with access; that admin's
// first sign-in (temporary password, email 2-step) lands on a zone with nothing in it. A Zonal Admin of zone A sees zone
// A only: a zone-B restaurant, order or partner answers 404 / is absent. A Zonal Admin of A + B sees both with the Zone
// column and narrows with the switcher. A Zonal Admin with no zone has no vendor pages.

const TEMP_PASSWORD = 'Harbour-lantern-quiet-2026';
const NEW_PASSWORD = 'Saffron-meadow-compass-2026';

/** First sign-in of a new account: change the temporary password and set up email 2-step, in whatever order asked. */
async function completeFirstSignIn(page: Page, email: string): Promise<void> {
  for (let step = 0; step < 6; step++) {
    await page.waitForURL(/\/(change-password|2fa\/setup|2fa|zone\/dashboard)$/, {
      timeout: 20_000,
    });
    const url = new URL(page.url()).pathname;
    if (url === '/zone/dashboard') return;
    if (url === '/change-password') {
      await page.getByLabel('Current password', { exact: true }).fill(TEMP_PASSWORD);
      await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel('Repeat the new password').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await page.waitForURL((u) => u.pathname !== '/change-password', { timeout: 20_000 });
      continue;
    }
    if (url === '/2fa/setup') {
      await pickMethod(page, 'Email code');
      const before = await ids(email);
      await page.getByRole('button', { name: 'Send code' }).click();
      await typeCode(page, await emailedCode(email, before));
      await page.getByLabel('I have saved these codes').check();
      await page.getByRole('button', { name: 'Finish and sign in' }).click();
      await page.waitForURL((u) => u.pathname !== '/2fa/setup', { timeout: 20_000 });
      continue;
    }
    // /2fa: an emailed code
    await pickMethod(page, 'Email code');
    const before = await ids(email);
    await typeCode(page, await emailedCode(email, before));
    await page.waitForURL((u) => u.pathname !== '/2fa', { timeout: 20_000 });
  }
  await expect(page).toHaveURL(/\/zone\/dashboard$/);
}

test('Flow 1: Super Admin creates a zone and a Zonal Admin with access; the new admin signs in (2-step) and sees only that zone', async ({
  page,
}) => {
  await signIn(page, world.superAdmin, 'Super Admin');

  // a new zone, activated
  await page.goto('/super-admin/zones');
  await page.getByRole('button', { name: 'Add zone' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Zone name').fill('Flow Mylapore');
  await form.getByLabel('Zone code').fill('FMYL');
  await form.getByLabel('City').fill('Chennai');
  await form.getByLabel('State').fill('Tamil Nadu');
  await form.getByLabel('Default delivery charge (₹)').fill('20');
  await form.getByLabel('Add individual pincodes').fill('600004');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await form.getByRole('button', { name: 'Create zone' }).click();
  await expect(page.getByRole('heading', { name: 'Flow Mylapore', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByRole('button', { name: 'Activate zone' }).click();
  await confirmPasswordIfAsked(page, page.getByRole('button', { name: 'Deactivate' }));

  // a new Zonal Admin with a temporary password, given the new zone with the operations profile
  const email = `flow-new-${Date.now()}@example.test`;
  await page.goto('/super-admin/zonal-admins');
  await page.getByRole('button', { name: 'Add Zonal Admin' }).click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Full name').fill('Flow New Member');
  await add.getByLabel('Email').fill(email);
  await add.getByLabel('Temporary password').fill(TEMP_PASSWORD);
  await add.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/super-admin\/access\/members\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Add zone' }).first().click();
  const zoneDialog = page.getByRole('dialog');
  const zoneSelect = zoneDialog.getByLabel('Zone');
  const option = zoneSelect.locator('option', { hasText: 'Flow Mylapore' });
  await zoneSelect.selectOption((await option.getAttribute('value')) ?? '');
  await zoneDialog.getByLabel('Access profile').selectOption({ label: world.profileName });
  await zoneDialog.getByRole('button', { name: 'Add zone' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await confirmPasswordIfAsked(page, page.getByText('Access saved'));
  await signOut(page);

  // the new admin's first sign-in
  await passwordStep(page, email, 'Zonal Admin', TEMP_PASSWORD);
  await completeFirstSignIn(page, email);
  await axe(page, 'new zonal admin dashboard');

  // only their (empty) zone: no zone-A or zone-B vendors or orders
  await page.goto('/zone/restaurants');
  await expect(page.getByRole('heading', { name: 'Restaurants', level: 1 })).toBeVisible();
  await expect(page.getByText('No restaurants yet')).toBeVisible();
  await expect(page.getByText('Flow Kitchen Adyar')).toHaveCount(0);
  await expect(page.getByText('Zone B Biryani')).toHaveCount(0);
  await page.goto('/zone/orders');
  await expect(page.getByText('No orders yet')).toBeVisible();
  // and the API agrees: the zone-A restaurant is not theirs
  expect((await page.request.get(`/api/v1/restaurants/${world.vendors.onboard}`)).status()).toBe(
    404,
  );
  await signOut(page);
});

test('Flow 2: Zonal Admin of zone A sees zone A only; zone-B restaurant, order and partner answer 404', async ({
  page,
}) => {
  await signIn(page, world.zaA, 'Zonal Admin');

  await page.goto('/zone/restaurants');
  const table = page.getByRole('table', { name: 'Restaurants' });
  await expect(table.getByRole('button', { name: 'Flow Kitchen Adyar' })).toBeVisible();
  await expect(table.getByText('Zone B Biryani')).toHaveCount(0);
  // one zone in scope: no Zone column (doc 36)
  await expect(table.getByRole('columnheader', { name: 'Zone' })).toHaveCount(0);
  await axe(page, 'zonal restaurants list');

  // the list masks phones (D26)
  await expect(table.getByText('+919876543210')).toHaveCount(0);

  // cross-zone objects: 404 from the API, an error card on the screen, nothing of the object shown
  const restaurantStatus = await apiStatus(page, `/restaurants/${world.vendors.restaurantB}`, () =>
    page.goto(`/zone/restaurants/${world.vendors.restaurantB}`),
  );
  expect(restaurantStatus).toBe(404);
  await expect(page.getByText(/could not be loaded/)).toBeVisible();
  await expect(page.getByText('Zone B Biryani')).toHaveCount(0);

  const orderStatus = await apiStatus(page, `/orders/${world.orders.zoneB.id}`, () =>
    page.goto(`/zone/orders/${world.orders.zoneB.id}`),
  );
  expect(orderStatus).toBe(404);
  await expect(page.getByText(world.orders.zoneB.no)).toHaveCount(0);

  // the orders list holds zone A's three orders and not zone B's
  await page.goto('/zone/orders');
  await expect(page.getByText(world.orders.walk.no)).toBeVisible();
  await expect(page.getByText(world.orders.zoneB.no)).toHaveCount(0);

  // delivery partners (API: the web screens are not committed yet): zone A's rider only; zone B's is a 404
  const partners = await page.request.get('/api/v1/delivery-partners');
  expect(partners.status()).toBe(200);
  const names = ((await partners.json()) as { data: { name: string }[] }).data.map((p) => p.name);
  expect(names).toContain('Ravi Rider');
  expect(names).not.toContain('Bala Rider');
  expect(
    (await page.request.get(`/api/v1/delivery-partners/${world.partners.riderB}`)).status(),
  ).toBe(404);
  // naming zone B in a query is refused (doc 36: unassigned zone id -> 404 ZONE_NOT_FOUND)
  const named = await page.request.get(`/api/v1/restaurants?zoneId=${world.zoneB.id}`);
  expect(named.status()).toBe(404);
  await signOut(page);
});

test('Flow 3: Zonal Admin of zones A + B sees both with the Zone column; the switcher narrows to one', async ({
  page,
}) => {
  await signIn(page, world.zaAB, 'Zonal Admin');

  await page.goto('/zone/restaurants');
  const table = page.getByRole('table', { name: 'Restaurants' });
  await expect(table.getByRole('button', { name: 'Flow Kitchen Adyar' })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Zone B Biryani' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Zone' })).toBeVisible();

  await page.goto('/zone/orders');
  await expect(page.getByText(world.orders.walk.no)).toBeVisible();
  await expect(page.getByText(world.orders.zoneB.no)).toBeVisible();

  // switcher: zone B only
  await page.getByRole('button', { name: /Zone shown/ }).click();
  await page
    .getByRole('list', { name: 'Choose the zone to show' })
    .getByRole('button', { name: new RegExp(world.zoneB.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`[?&]zone=${world.zoneB.code}`));
  await expect(page.getByText(world.orders.zoneB.no)).toBeVisible();
  await expect(page.getByText(world.orders.walk.no)).toHaveCount(0);

  // a zone code that is not theirs in the URL never widens anything
  await page.goto('/zone/orders?zone=NOPE1');
  await expect(page.getByText(world.orders.walk.no)).toBeVisible();

  // back to all of their zones
  await page.getByRole('button', { name: /Zone shown/ }).click();
  await page
    .getByRole('list', { name: 'Choose the zone to show' })
    .getByRole('button')
    .first()
    .click();
  await expect(page).not.toHaveURL(/zone=/);
  await signOut(page);
});

test('Flow 4: Zonal Admin with no zone has no vendor or order pages and the API returns nothing', async ({
  page,
}) => {
  // with no zone the sign-in lands on its own page, not the dashboard
  await signIn(page, world.zaNone, 'Zonal Admin', /\/zone\/no-zones$/);
  await expect(
    page.getByRole('heading', { name: 'You are not assigned to any zone yet', level: 1 }),
  ).toBeVisible();
  await axe(page, 'no zones page');
  // the vendor and order pages are closed: a 404 page or back to the no-zones page, never data
  const closed = page
    .getByRole('heading', { name: 'Page not found' })
    .or(page.getByRole('heading', { name: 'You are not assigned to any zone yet' }));
  await page.goto('/zone/restaurants');
  await expect(closed).toBeVisible();
  await expect(page.getByText('Flow Kitchen Adyar')).toHaveCount(0);
  await page.goto(`/zone/orders/${world.orders.walk.id}`);
  await expect(closed).toBeVisible();
  await expect(page.getByText(world.orders.walk.no)).toHaveCount(0);
  const res = await page.request.get('/api/v1/restaurants');
  // 403 (no restaurants:view anywhere) or an empty page; never another zone's rows
  if (res.status() === 200) {
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  } else {
    expect([403, 404]).toContain(res.status());
  }
  const orders = await page.request.get('/api/v1/orders');
  if (orders.status() === 200)
    expect(((await orders.json()) as { data: unknown[] }).data).toEqual([]);
  else expect([403, 404]).toContain(orders.status());
});
