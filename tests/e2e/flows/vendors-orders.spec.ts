import { expect, test, type Page } from '@playwright/test';
import { axe, axeSoft, confirmPasswordIfAsked, signIn, signOut, world } from './support';

// Flow 5-9 (QA, 2026-10-18): vendor onboarding (masked contacts, a document uploaded, accepted, the vendor verified and
// activated, an audited reveal); an order walked PLACED -> ACCEPTED -> PREPARING -> READY -> ASSIGNED with the partner
// picker honouring the cap (default 1), a stale version refused (If-Match), the cap raised in Platform Settings and a
// second order assigned to the same partner, delivery, a cancellation with a reason; then the audit rows in System Logs.
// Runs after access-scope.spec.ts (file order, one worker) on the same seeded database.

// a 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const statusCard = (page: Page) => page.locator('[aria-labelledby="order-status"]');

test('Flow 5: vendor onboarding by the Zonal Admin: masked contacts, document uploaded and accepted, verify, activate, audited reveal', async ({
  page,
}) => {
  await signIn(page, world.zaA, 'Zonal Admin');
  await page.goto(`/zone/restaurants/${world.vendors.onboard}`);
  await expect(page.getByRole('heading', { name: 'Flow Kitchen Adyar', level: 1 })).toBeVisible();
  await expect(page.getByText('Not verified').first()).toBeVisible();
  await axeSoft(page, 'zonal restaurant detail');

  // D26: phone and email masked on the detail page until revealed
  const details = page.locator('[aria-labelledby="vendor-details"]');
  await expect(details.getByText('+919876543210')).toHaveCount(0);
  await expect(details.getByText('meena.owner@example.test')).toHaveCount(0);

  // a document: upload (presign -> S3 PUT -> confirm -> attach), waits to be checked, then accepted
  const docs = page.locator('[aria-labelledby="vendor-docs"]');
  await docs.getByLabel('Document type').selectOption('FSSAI');
  await page.locator('#vendor-doc-file').setInputFiles({
    name: 'fssai.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(docs.getByRole('list', { name: 'Uploaded documents' })).toContainText(
    'FSSAI licence',
    { timeout: 20_000 },
  );
  await expect(docs.getByRole('list', { name: 'Uploaded documents' })).toContainText('To check');
  await docs.getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await confirmPasswordIfAsked(
    page,
    docs.getByRole('list', { name: 'Uploaded documents' }).getByText('Accepted'),
  );

  // verify, then activate (activate needs verification first, doc 10 section 4)
  const decisions = page.locator('[aria-labelledby="decisions"]');
  await expect(decisions.getByRole('button', { name: 'Activate' })).toBeDisabled();
  await decisions.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
  await confirmPasswordIfAsked(page, page.getByText('Verified', { exact: true }));
  await decisions.getByRole('button', { name: 'Activate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Activate' }).click();
  await confirmPasswordIfAsked(page, page.getByText('Active', { exact: true }));
  await expect(decisions.getByRole('button', { name: 'Deactivate' })).toBeVisible();

  // D123: the reveal shows the real phone and email, and says it is recorded
  await details.getByRole('button', { name: 'Reveal contact' }).click();
  await expect(details.getByText('+919876543210')).toBeVisible();
  await expect(details.getByText('meena.owner@example.test')).toBeVisible();

  // Home Food: same screens; the provider's phone is masked too
  await page.goto(`/zone/homemakers/${world.vendors.homeFood}`);
  await expect(page.getByRole('heading', { name: 'Amma Home Food', level: 1 })).toBeVisible();
  await expect(page.getByText('+919812345678')).toHaveCount(0);
  await signOut(page);
});

test('Flow 6: order PLACED -> ACCEPTED -> PREPARING -> READY -> ASSIGNED; a stale version is refused; the picker honours the cap of 1', async ({
  page,
  context,
}) => {
  await signIn(page, world.zaA, 'Zonal Admin');
  const walk = world.orders.walk;
  await page.goto(`/zone/orders/${walk.id}`);
  await expect(page.getByRole('heading', { name: `Order ${walk.no}`, level: 1 })).toBeVisible();
  await expect(statusCard(page).getByText('New', { exact: true })).toBeVisible();
  await axe(page, 'zonal order detail');

  // If-Match: another tab accepts the order first; this tab's version is stale -> 409, the screen says so and reloads
  const other = await context.newPage();
  await other.goto(`/zone/orders/${walk.id}`);
  await other.getByRole('button', { name: 'Accept' }).click();
  await expect(statusCard(other).getByText('Accepted', { exact: true })).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(statusCard(page).getByRole('alert')).toContainText('changed a moment ago');
  await expect(statusCard(page).getByText('Accepted', { exact: true })).toBeVisible();

  // the kitchen moves
  await page.getByRole('button', { name: 'Start preparing' }).click();
  await expect(statusCard(page).getByText('Preparing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await expect(statusCard(page).getByText('Ready', { exact: true })).toBeVisible();

  // assign: only zone A's rider is offered (never zone B's), carrying 0 of 1
  await page.getByRole('button', { name: 'Assign partner' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Ravi Rider')).toBeVisible();
  await expect(dialog.getByText('Bala Rider')).toHaveCount(0);
  await expect(dialog.getByText(/0 of 1 order\b/)).toBeVisible();
  await axe(page, 'assign partner dialog');
  await dialog.getByRole('radio').first().check();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(statusCard(page).getByText('Partner assigned', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-labelledby="order-people"]')).toContainText('Ravi Rider');

  // the second order (READY): the same rider is full at the default cap of 1
  const ready = world.orders.ready;
  await page.goto(`/zone/orders/${ready.id}`);
  await page.getByRole('button', { name: 'Assign partner' }).click();
  const second = page.getByRole('dialog');
  await expect(second.getByText(/1 of 1 order · full/)).toBeVisible();
  await expect(second.getByRole('radio').first()).toBeDisabled();
  await expect(second.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
  await second.getByRole('button', { name: 'Cancel' }).click();

  // and the API refuses it too (D121), whatever the screen shows
  // the session CSRF token comes with /me, as the web client takes it
  const me = (await (await page.request.get('/api/v1/me')).json()) as { csrfToken?: string };
  const detail = (await (await page.request.get(`/api/v1/orders/${ready.id}`)).json()) as {
    version: number;
  };
  const refused = await page.request.post(`/api/v1/orders/${ready.id}/assign`, {
    headers: {
      'If-Match': String(detail.version),
      'X-CSRF-Token': me.csrfToken ?? '',
      Origin: new URL(page.url()).origin,
    },
    data: { deliveryPartnerId: world.partners.riderA },
  });
  expect(refused.status()).toBe(409);
  expect(JSON.stringify(await refused.json())).toContain('PARTNER_AT_CAPACITY');
  await signOut(page);
});

test('Flow 7: the Super Admin raises orders-per-partner to 2 in Platform Settings; the second order goes to the same rider', async ({
  page,
}) => {
  await signIn(page, world.superAdmin, 'Super Admin');
  await page.goto('/super-admin/settings/platform');
  const cap = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Orders per delivery partner' }) });
  await cap.getByRole('button', { name: 'Edit Orders per delivery partner' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Orders a partner can carry at once').fill('2');
  await editor.getByRole('button', { name: /Review change/ }).click();
  await editor.getByLabel('Reason for the change').fill('Weekend batching in the QA run');
  await editor.getByRole('button', { name: 'Save' }).click();
  await confirmPasswordIfAsked(page, page.getByText('Orders per delivery partner saved'));
  await expect(cap.getByText('Set by Super Admin')).toBeVisible();
  await signOut(page);

  await signIn(page, world.zaA, 'Zonal Admin');
  const ready = world.orders.ready;
  await page.goto(`/zone/orders/${ready.id}`);
  await page.getByRole('button', { name: 'Assign partner' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/1 of 2 order/)).toBeVisible();
  await dialog.getByRole('radio').first().check();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(statusCard(page).getByText('Partner assigned', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-labelledby="order-people"]')).toContainText('Ravi Rider');
  await signOut(page);
});

test('Flow 8: deliver the first order; cancel another with a reason', async ({ page }) => {
  await signIn(page, world.zaA, 'Zonal Admin');
  const walk = world.orders.walk;
  await page.goto(`/zone/orders/${walk.id}`);
  await page.getByRole('button', { name: 'Out for delivery' }).click();
  await expect(statusCard(page).getByText('Out for delivery', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(statusCard(page).getByText('Delivered', { exact: true })).toBeVisible();
  await expect(statusCard(page)).toContainText('This order is closed');
  // the timeline lists every move
  const timeline = page.locator('[aria-labelledby="order-timeline"]');
  for (const s of ['Accepted', 'Preparing', 'Ready', 'Partner assigned', 'Delivered'])
    await expect(timeline.getByText(s, { exact: true }).first()).toBeVisible();

  const cancel = world.orders.cancel;
  await page.goto(`/zone/orders/${cancel.id}`);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel order' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Vendor closed early');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(statusCard(page).getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(statusCard(page)).toContainText('Vendor closed early');

  // the cancelled tab lists it
  await page.goto('/zone/orders?tab=cancelled');
  await expect(page.getByText(cancel.no)).toBeVisible();
  await signOut(page);
});

test('Flow 9: the Super Admin finds the audit rows of these flows in System Logs', async ({
  page,
}) => {
  await signIn(page, world.superAdmin, 'Super Admin');
  const table = page.getByRole('table', { name: 'Activity log' });

  await page.goto('/super-admin/settings/logs?module=orders');
  for (const label of [
    'Accepted order on vendor behalf',
    'Changed order status',
    'Assigned delivery partner',
    'Cancelled order (admin)',
  ])
    await expect(table.getByText(label).first()).toBeVisible();

  await page.goto('/super-admin/settings/logs?module=restaurants');
  for (const label of [
    'Added document',
    'Verified document',
    'Verified restaurant',
    'Activated restaurant',
    'Revealed contact details',
  ])
    await expect(table.getByText(label).first()).toBeVisible();

  // the setting change is in Settings History with its reason
  await page.goto('/super-admin/settings/history');
  const changes = page.getByRole('list', { name: 'Setting changes' });
  await expect(changes.getByText(/Weekend batching in the QA run/)).toBeVisible();
  await axe(page, 'settings history');
  await signOut(page);
});
