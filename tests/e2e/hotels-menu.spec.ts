import { expect, test, type Page } from '@playwright/test';

/**
 * Hotel Room Booking + Menu/Food Items journey (doc 48 area, owner-authorized
 * deviation D23/D61): guard → login → hotel create → Room Bookings section →
 * Dining section → dining create → Menu/Food Items create → bulk approve.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';

const stamp = Date.now();
const hotelName = `E2E Grand ${stamp}`;
const itemName = `E2E Paneer ${stamp}`;

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
  await page.getByRole('dialog').locator('[id$="-zone"]').first().click();
  await page.getByRole('option', { name: zoneName, exact: true }).click();
}

test('unauthenticated visitors are redirected from the hotel room booking route', async ({
  page,
}) => {
  await page.goto('/super-admin/hotel-room-booking');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('super admin manages hotels, dining and menu items end to end', async ({ page }) => {
  test.setTimeout(180_000);

  // Hotels overview.
  await loginVia(page, '/super-admin/hotel-room-booking');
  await expect(page.getByRole('heading', { name: 'Hotel Room Booking Management' })).toBeVisible();
  await expect(page.getByText('Occupancy by zone')).toBeVisible();

  // Hotel create.
  await page.getByRole('button', { name: 'Add hotel' }).first().click();
  const hotelDialog = page.getByRole('dialog');
  await expect(hotelDialog.getByRole('heading', { name: 'Add hotel' })).toBeVisible();
  await pickZone(page, 'Chennai');
  await hotelDialog.locator('#hotel-name').fill(hotelName);
  await hotelDialog.locator('#hotel-owner').fill('Meera Iyer');
  await hotelDialog.locator('#hotel-phone').fill('9845012345');
  await hotelDialog.locator('#hotel-email').fill('meera@example.com');
  await hotelDialog.locator('#hotel-address').fill('9, Cathedral Road');
  await hotelDialog.locator('#hotel-area').fill('Gopalapuram');
  await hotelDialog.locator('#hotel-rooms').fill('20');
  await hotelDialog.locator('#hotel-commission').fill('12');
  await hotelDialog.getByRole('button', { name: 'Create hotel' }).click();
  await expect(hotelDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Hotel created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(hotelName) }).first()).toBeVisible();

  // Room Bookings section.
  await page.getByRole('tab', { name: 'Room Bookings' }).click();
  await expect(page.getByLabel('Search bookings')).toBeVisible();
  await expect(page.getByLabel('Filter by booking status')).toBeVisible();

  // Dining section — create a dining reservation against the new hotel.
  await page.getByRole('tab', { name: 'Dining', exact: true }).click();
  await expect(page.getByLabel('Search dining')).toBeVisible();
  await page.getByRole('button', { name: 'Add dining' }).first().click();
  const diningDialog = page.getByRole('dialog');
  await expect(diningDialog.getByRole('heading', { name: 'Add dining reservation' })).toBeVisible();
  await diningDialog.locator('#dining-venue').click();
  await page
    .getByRole('option', { name: new RegExp(hotelName) })
    .first()
    .click();
  await diningDialog.locator('#dining-name').fill('Lakshmi Iyer');
  await diningDialog.locator('#dining-phone').fill('9845099999');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await diningDialog.locator('#dining-date').fill(tomorrow);
  await diningDialog.locator('#dining-guests').fill('4');
  await diningDialog.getByRole('button', { name: 'Create reservation' }).click();
  await expect(diningDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Dining reservation created' })).toBeVisible();

  // Menu / Food Items page.
  await page.getByRole('link', { name: 'Menu / Food Items' }).click();
  await page.waitForURL('**/super-admin/menu-items');
  await expect(page.getByRole('heading', { name: 'Menu & Food Items' })).toBeVisible();

  // Menu item create — target the hotel created above via the provider type.
  await page.getByRole('button', { name: 'Add item' }).first().click();
  const itemDialog = page.getByRole('dialog');
  await expect(itemDialog.getByRole('heading', { name: 'Add menu item' })).toBeVisible();
  await itemDialog.locator('#item-owner-kind').click();
  await page.getByRole('option', { name: 'Hotel', exact: true }).click();
  await itemDialog.locator('#item-provider').click();
  await page
    .getByRole('option', { name: new RegExp(hotelName) })
    .first()
    .click();
  await itemDialog.locator('#item-name').fill(itemName);
  await itemDialog.locator('#item-category').fill('Main course');
  await itemDialog.locator('#item-price').fill('260');
  await itemDialog.getByRole('button', { name: 'Create item' }).click();
  await expect(itemDialog).toBeHidden();
  await expect(
    toasts(page)
      .filter({ hasText: /created/i })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(itemName) }).first()).toBeVisible();

  // Bulk selection bar appears once a row is checked (scoped to the bar, since
  // row actions have the same labels).
  const firstCheckbox = page.locator('tbody input[type="checkbox"]').first();
  await firstCheckbox.click();
  const bulkBar = page.locator('div.bg-orange-50').first();
  await expect(bulkBar).toContainText('selected');
  await expect(bulkBar.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();

  // Tab filtering — Pending Approvals shows only PENDING rows, and the item
  // created above (still pending) is findable there via search.
  await page.getByRole('tab', { name: /Pending Approvals/ }).click();
  await expect(page).toHaveURL(/tab=pendingItems/);
  await page.getByLabel('Search menu items').fill(itemName);
  const pendingRow = page.getByRole('cell', { name: new RegExp(itemName) }).first();
  await expect(pendingRow).toBeVisible();
  await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();

  // View — opens the details dialog for that exact row, then closes.
  await page.getByRole('button', { name: `Actions for ${itemName}` }).click();
  await page.getByRole('menuitem', { name: 'View details' }).click();
  const viewDialog = page.getByRole('dialog');
  await expect(viewDialog.getByRole('heading', { name: itemName })).toBeVisible();
  await expect(viewDialog.getByText('₹260')).toBeVisible();

  // Edit — from the same row, the form is prefilled and saving persists.
  await viewDialog.getByRole('button', { name: 'Edit item' }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByRole('heading', { name: 'Edit menu item' })).toBeVisible();
  await expect(editDialog.locator('#item-name')).toHaveValue(itemName);
  await expect(editDialog.locator('#item-price')).toHaveValue('260');
  await editDialog.locator('#item-price').fill('285');
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(editDialog).toBeHidden();
  await expect(toasts(page).filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page.getByText('₹285').first()).toBeVisible();
});
