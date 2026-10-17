# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vendors.spec.ts >> super admin manages restaurants and homemakers end to end
- Location: tests\e2e\vendors.spec.ts:41:5

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.fill: Test timeout of 120000ms exceeded.
Call log:
  - waiting for getByRole('dialog').locator('#vendor-area')

```

# Page snapshot

```yaml
- generic:
    - generic:
        - banner [aria-hidden]:
            - button
            - generic: Restaurant Management
            - generic:
                - searchbox
            - generic:
                - combobox
                - button
                - button:
                    - generic: SA
                    - generic:
                        - generic: Super Admin
                        - generic: admin@zoauro.test
        - generic:
            - complementary [aria-hidden]:
                - generic:
                    - generic:
                        - generic:
                            - generic [aria-hidden]: G
                        - generic:
                            - generic: GLOARO
                            - generic: SUPER ADMIN
                        - button
                - navigation:
                    - generic:
                        - button [expanded]:
                            - generic: Overview
                        - generic:
                            - generic: Dashboard Overview
                            - generic: Recent Activities
                    - generic:
                        - button [expanded]:
                            - generic: Service Management
                        - generic:
                            - link:
                                - /url: /super-admin/restaurants
                                - generic: Restaurants
                            - link:
                                - /url: /super-admin/homemakers
                                - generic: Home Food
                            - link:
                                - /url: /super-admin/hotel-room-booking
                                - generic: Hotel Room Booking
                            - link:
                                - /url: /super-admin/menu-items
                                - generic: Menu / Food Items
                    - generic:
                        - button [expanded]:
                            - generic: Zone Operations
                        - generic:
                            - generic: Zonal Permissions
                            - generic: Zonal Statistics
                            - generic: Zonal Admin Settings
                            - link:
                                - /url: /super-admin/zones
                                - generic: Legacy Zone Directory
                    - generic:
                        - button:
                            - generic: Orders & Customers
                    - generic:
                        - button:
                            - generic: Delivery Partners
                    - generic:
                        - button:
                            - generic: Support & Engagement
                    - generic:
                        - button:
                            - generic: Administration
                - generic:
                    - generic:
                        - paragraph: Need Assistance?
                        - paragraph: Contact Platform Support
                        - generic: Open Help Center
            - main:
                - generic:
                    - navigation [aria-hidden]:
                        - link:
                            - /url: /super-admin
                            - text: Dashboard
                        - generic [aria-hidden]: /
                        - generic: Restaurant Management
                    - generic [aria-hidden]:
                        - generic:
                            - heading [level=1]: Restaurant Management
                            - paragraph: Independent restaurant operations, financials and performance.
                        - generic:
                            - button: Add Restaurant
                    - generic [aria-hidden]: Simulated operational data · Financial values distinguish transaction value from platform revenue.
                    - generic [aria-hidden]:
                        - generic:
                            - generic:
                                - paragraph: Registered Restaurants
                                - paragraph: '428'
                                - paragraph: +8 this month
                        - generic:
                            - generic:
                                - paragraph: Active
                                - paragraph: '356'
                                - paragraph: Verified businesses
                        - generic:
                            - generic:
                                - paragraph: Orders
                                - paragraph: 12,842
                                - paragraph: Current period
                        - generic:
                            - generic:
                                - paragraph: Gross Revenue
                                - paragraph: ₹48.6L
                                - paragraph: +12.4% growth
                        - generic:
                            - generic:
                                - paragraph: Platform Commission
                                - paragraph: ₹7.29L
                                - paragraph: 15% of eligible GMV
                        - generic:
                            - generic:
                                - paragraph: Refunds
                                - paragraph: ₹1.12L
                                - paragraph: 2.3% transaction value
                    - tablist [aria-hidden]:
                        - tab [selected]: Overview
                        - tab: Orders
                        - tab: Financials
                        - tab: Performance
                        - tab: Activity History
                    - generic [aria-hidden]:
                        - generic:
                            - generic:
                                - generic:
                                    - heading [level=2]: Restaurant revenue trend
                                    - paragraph: Gross value, commission and net platform revenue
                                - combobox:
                                    - generic: Monthly
                            - generic:
                                - generic:
                                    - generic:
                                        - generic: Aug
                                        - generic: Sep
                                        - generic: Oct
                                        - generic: Nov
                                        - generic: Dec
                                        - generic: Jan
                        - generic:
                            - heading [level=2]: Top performers
                            - paragraph: Current filtered period
                            - list:
                                - listitem:
                                    - generic: '1'
                                    - generic:
                                        - generic: The Marina Table
                                        - generic: Anna Nagar · 120 orders
                                    - generic: ₹8.4L
                                - listitem:
                                    - generic: '2'
                                    - generic:
                                        - generic: Anjappar Heritage
                                        - generic: Ambattur · 107 orders
                                    - generic: ₹7.7L
                                - listitem:
                                    - generic: '3'
                                    - generic:
                                        - generic: Copper Chimney
                                        - generic: Adyar · 94 orders
                                    - generic: ₹7.0L
                                - listitem:
                                    - generic: '4'
                                    - generic:
                                        - generic: Sangeetha Veg
                                        - generic: KK Nagar · 81 orders
                                    - generic: ₹6.3L
                                - listitem:
                                    - generic: '5'
                                    - generic:
                                        - generic: Dakshin Dining
                                        - generic: T. Nagar · 68 orders
                                    - generic: ₹5.6L
                    - generic:
                        - generic [aria-hidden]:
                            - generic:
                                - generic:
                                    - searchbox
                                - generic:
                                    - combobox:
                                        - generic: All zones
                                    - combobox [disabled]:
                                        - generic: All areas
                                    - combobox:
                                        - generic: All statuses
                                    - button: Export CSV
                        - generic [aria-hidden]:
                            - table:
                                - rowgroup:
                                    - row:
                                        - columnheader: Restaurant
                                        - columnheader: Owner & contact
                                        - columnheader: Zone / admin
                                        - columnheader: Orders
                                        - columnheader: Gross value
                                        - columnheader: Commission
                                        - columnheader: Refunds
                                        - columnheader: Payout
                                        - columnheader: Status
                                        - columnheader: Actions
                                - rowgroup:
                                    - row:
                                        - cell:
                                            - generic: The Marina Table
                                            - generic: RST-1201
                                        - cell:
                                            - generic: Riya Sharma
                                            - generic: +91 98720 3400
                                        - cell:
                                            - generic: Anna Nagar
                                            - generic: Malik Rahman
                                        - cell:
                                            - generic: '382'
                                            - generic: completed orders
                                        - cell: ₹6.8L
                                        - cell: ₹1.02L
                                        - cell: ₹0.12L
                                        - cell: ₹5.66L
                                        - cell:
                                            - generic: Active
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'ON'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: Anjappar Heritage
                                            - generic: RST-1202
                                        - cell:
                                            - generic: Haidar Ali
                                            - generic: +91 98720 3401
                                        - cell:
                                            - generic: Ambattur
                                            - generic: Vijay Kumar
                                        - cell:
                                            - generic: '355'
                                            - generic: completed orders
                                        - cell: ₹7.7L
                                        - cell: ₹1.15L
                                        - cell: ₹0.15L
                                        - cell: ₹6.40L
                                        - cell:
                                            - generic: Active
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'ON'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: Copper Chimney
                                            - generic: RST-1203
                                        - cell:
                                            - generic: Malik Rahman
                                            - generic: +91 98720 3402
                                        - cell:
                                            - generic: Adyar
                                            - generic: Ajith Raj
                                        - cell:
                                            - generic: '328'
                                            - generic: completed orders
                                        - cell: ₹8.6L
                                        - cell: ₹1.28L
                                        - cell: ₹0.18L
                                        - cell: ₹7.14L
                                        - cell:
                                            - generic: Active
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'ON'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: Sangeetha Veg
                                            - generic: RST-1204
                                        - cell:
                                            - generic: Vijay Kumar
                                            - generic: +91 98720 3403
                                        - cell:
                                            - generic: KK Nagar
                                            - generic: Nisha Menon
                                        - cell:
                                            - generic: '301'
                                            - generic: completed orders
                                        - cell: ₹9.5L
                                        - cell: ₹1.41L
                                        - cell: ₹0.21L
                                        - cell: ₹7.88L
                                        - cell:
                                            - generic: Active
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'ON'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: Dakshin Dining
                                            - generic: RST-1205
                                        - cell:
                                            - generic: Ajith Raj
                                            - generic: +91 98720 3404
                                        - cell:
                                            - generic: T. Nagar
                                            - generic: Riya Sharma
                                        - cell:
                                            - generic: '274'
                                            - generic: completed orders
                                        - cell: ₹10.4L
                                        - cell: ₹1.54L
                                        - cell: ₹0.24L
                                        - cell: ₹8.62L
                                        - cell:
                                            - generic: Inactive
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: Madras Spice
                                            - generic: RST-1206
                                        - cell:
                                            - generic: Nisha Menon
                                            - generic: +91 98720 3405
                                        - cell:
                                            - generic: Velachery
                                            - generic: Haidar Ali
                                        - cell:
                                            - generic: '247'
                                            - generic: completed orders
                                        - cell: ₹11.3L
                                        - cell: ₹1.67L
                                        - cell: ₹0.27L
                                        - cell: ₹9.36L
                                        - cell:
                                            - generic: Active
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'ON'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: E2E Dhaba 1792085438336
                                            - generic: RST-C85B
                                        - cell:
                                            - generic: Ravi Kumar
                                            - generic: 98****3210
                                        - cell:
                                            - generic: Chennai
                                            - generic: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell:
                                            - generic: Pending
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: E2E Dhaba 1792084230588
                                            - generic: RST-2F1E
                                        - cell:
                                            - generic: Ravi Kumar
                                            - generic: 98****3210
                                        - cell:
                                            - generic: Chennai
                                            - generic: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell:
                                            - generic: Pending
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: E2E Dhaba 1792062175630
                                            - generic: RST-3892
                                        - cell:
                                            - generic: Ravi Kumar
                                            - generic: 98****3210
                                        - cell:
                                            - generic: Chennai
                                            - generic: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell:
                                            - generic: Pending
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: E2E Dhaba 1792057392879
                                            - generic: RST-AA22
                                        - cell:
                                            - generic: Ravi Kumar
                                            - generic: 98****3210
                                        - cell:
                                            - generic: Chennai
                                            - generic: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell:
                                            - generic: Pending
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: E2E Dhaba 1792057205943
                                            - generic: RST-9ACF
                                        - cell:
                                            - generic: Ravi Kumar
                                            - generic: 98****3210
                                        - cell:
                                            - generic: Chennai
                                            - generic: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell:
                                            - generic: Pending
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                                    - row:
                                        - cell:
                                            - generic: E2E Dhaba 1792039106815
                                            - generic: RST-0378
                                        - cell:
                                            - generic: Ravi Kumar
                                            - generic: 98****3210
                                        - cell:
                                            - generic: Chennai
                                            - generic: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell: —
                                        - cell:
                                            - generic: Pending
                                        - cell:
                                            - generic:
                                                - button
                                                - button
                                                - button: 'OFF'
                                        - cell
                        - generic:
                            - paragraph: Showing 1–12 of 22 records
                            - navigation [aria-hidden]:
                                - button [disabled]
                                - button: '1'
                                - button: '2'
                                - button: '3'
                                - button
    - region "Notifications alt+T"
    - button "Open Next.js Dev Tools" [ref=e6] [cursor=pointer]
    - alert: Restaurant Management
    - dialog [ref=e11]:
        - generic [ref=e12]:
            - heading "Add restaurant" [level=2] [ref=e13]
            - paragraph [ref=e14]: Create a new restaurant in the chosen zone (starts as Pending).
        - generic [ref=e15]:
            - generic [ref=e16]:
                - generic [ref=e17]: Zone *
                - combobox "Zone *" [ref=e18]:
                    - generic: Chennai
                - combobox [aria-hidden] [ref=e21]
            - generic [ref=e22]:
                - generic [ref=e23]:
                    - generic [ref=e24]: Name *
                    - textbox "Name *" [ref=e25]:
                        - /placeholder: Annapoorna Mess
                        - text: Chennai 1792219322650
                - generic [ref=e26]:
                    - generic [ref=e27]: Owner *
                    - textbox "Owner *" [ref=e28]:
                        - /placeholder: Ravi Kumar
                        - text: Ravi Kumar
            - generic [ref=e29]:
                - generic [ref=e30]:
                    - generic [ref=e31]: Phone *
                    - textbox "Phone *" [ref=e32]:
                        - /placeholder: '9876543210'
                        - text: '9876543210'
                - generic [ref=e33]:
                    - text: Email
                    - textbox "Email" [ref=e34]:
                        - /placeholder: owner@example.com
                        - text: ravi@example.com
            - generic [ref=e35]:
                - generic [ref=e36]: Address *
                - textbox "Address *" [active] [ref=e37]:
                    - /placeholder: 12 Anna Salai, Chennai
                    - text: 12, 2nd Avenue
            - generic [ref=e38]:
                - generic [ref=e39]:
                    - text: Area
                    - combobox "Select area" [ref=e40]:
                        - generic: Choose an area
                    - combobox [aria-hidden] [ref=e43]
                - generic [ref=e44]:
                    - text: Commission %
                    - textbox "Commission %" [ref=e45]:
                        - /placeholder: '15'
                    - paragraph [ref=e46]: 0–50%. Super Admin only (doc 04).
            - generic [ref=e47]:
                - generic [ref=e48]:
                    - text: Latitude
                    - textbox "Latitude" [ref=e49]:
                        - /placeholder: '13.0418'
                - generic [ref=e50]:
                    - text: Longitude
                    - textbox "Longitude" [ref=e51]:
                        - /placeholder: '80.2341'
            - generic [ref=e52]:
                - generic [ref=e53]: Cuisines *
                - textbox "Cuisines *" [ref=e54]:
                    - /placeholder: North Indian, Chinese
                - paragraph [ref=e55]: Comma-separated, up to 5.
            - generic [ref=e56]:
                - button "Cancel" [ref=e57]
                - button "Create restaurant" [ref=e58]
        - button "Close" [ref=e59]
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   |
  3   | /**
  4   |  * M06/M07 journey (doc 24 TC-UI-2/TC-UI-3, doc 18 §5 routes, doc 20/21/22):
  5   |  * guard → login → restaurant create (zone, area) → tab walk between the two
  6   |  * canonical routes → homemaker create → detail reveal → opening-hours edit →
  7   |  * SA-2.1 documents (presigned upload, signed view, verify).
  8   |  */
  9   |
  10  | const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
  11  | const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';
  12  |
  13  | const stamp = Date.now();
  14  | const restaurantName = `Chennai ${stamp}`;
  15  | const homemakerName = `Cloud Kitchen ${stamp}`;
  16  |
  17  | function toasts(page: Page) {
  18  |   return page.locator('[data-sonner-toast]');
  19  | }
  20  |
  21  | async function loginVia(page: Page, nextPath: string) {
  22  |   await page.goto(nextPath);
  23  |   await expect(page).toHaveURL(/\/login\?next=/);
  24  |   await page.fill('#email', EMAIL);
  25  |   await page.fill('#password', PASSWORD);
  26  |   await page.getByRole('button', { name: 'Sign in' }).click();
  27  |   await page.waitForURL(`**${nextPath}`);
  28  | }
  29  |
  30  | async function pickZone(page: Page, zoneName: string) {
  31  |   await page.getByRole('dialog').locator('#vendor-zone').click();
  32  |   await page.getByRole('option', { name: zoneName, exact: true }).click();
  33  | }
  34  |
  35  | test('unauthenticated visitors are redirected from the homemakers route', async ({ page }) => {
  36  |   await page.goto('/super-admin/homemakers');
  37  |   await expect(page).toHaveURL(/\/login\?next=/);
  38  |   await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  39  | });
  40  |
  41  | test('super admin manages restaurants and homemakers end to end', async ({ page }) => {
  42  |   test.setTimeout(120_000);
  43  |   await loginVia(page, '/super-admin/restaurants');
  44  |   await expect(page.getByRole('heading', { name: 'Restaurant Management' })).toBeVisible();
  45  |   await expect(page.getByText('Registered Restaurants')).toBeVisible();
  46  |
  47  |   // Restaurant create — zone, identity and area all persist (doc 22).
  48  |   await page.getByRole('button', { name: 'Add Restaurant' }).first().click();
  49  |   const createDialog = page.getByRole('dialog');
  50  |   await expect(createDialog.getByRole('heading', { name: 'Add restaurant' })).toBeVisible();
  51  |   await pickZone(page, 'Chennai');
  52  |   await createDialog.locator('#vendor-name').fill(restaurantName);
  53  |   await createDialog.locator('#vendor-owner').fill('Ravi Kumar');
  54  |   await createDialog.locator('#vendor-phone').fill('9876543210');
  55  |   await createDialog.locator('#vendor-email').fill('ravi@example.com');
  56  |   await createDialog.locator('#vendor-address').fill('12, 2nd Avenue');
> 57  |   await createDialog.locator('#vendor-area').fill('Tambaram');
      |                                              ^ Error: locator.fill: Test timeout of 120000ms exceeded.
  58  |   await createDialog.locator('#vendor-cuisines').fill('Biryani, Chinese');
  59  |   await createDialog.getByRole('button', { name: 'Create restaurant' }).click();
  60  |   await expect(createDialog).toBeHidden();
  61  |   await expect(toasts(page).filter({ hasText: 'Restaurant created' })).toBeVisible();
  62  |   await expect(page.getByRole('cell', { name: new RegExp(restaurantName) }).first()).toBeVisible();
  63  |   await expect(page.getByRole('cell', { name: /^Chennai/ }).first()).toBeVisible();
  64  |   await expect(page.getByRole('columnheader', { name: 'Gross value' })).toBeVisible();
  65  |
  66  |   // Search narrows to the new row (URL-synced q, doc 20/22).
  67  |   await page.getByLabel('Search restaurants').fill(restaurantName);
  68  |   await expect(page).toHaveURL(/q=E2E/);
  69  |   await expect(page.getByRole('row')).toHaveCount(2); // header + one match
  70  |   await page.getByLabel('Search restaurants').fill('');
  71  |   await expect(page).not.toHaveURL(/q=/); // debounce committed the clear
  72  |
  73  |   // Tab walk goes to the canonical sibling route (doc 18 §5) via the sidebar
  74  |   // (the reference screens navigate kinds through Service Management links).
  75  |   await page.getByRole('link', { name: 'Home Food', exact: true }).click();
  76  |   await page.waitForURL('**/super-admin/homemakers');
  77  |   await expect(page.getByRole('heading', { name: 'Home Food Management' })).toBeVisible();
  78  |   await expect(page.getByText('Registered Providers')).toBeVisible();
  79  |
  80  |   // Homemaker create with its own kind-specific fields (doc 21/22).
  81  |   await page.getByRole('button', { name: 'Add Provider' }).first().click();
  82  |   const homemakerDialog = page.getByRole('dialog');
  83  |   await expect(homemakerDialog.getByRole('heading', { name: 'Add homemaker' })).toBeVisible();
  84  |   await pickZone(page, 'Chennai');
  85  |   await homemakerDialog.locator('#vendor-name').fill(homemakerName);
  86  |   await homemakerDialog.locator('#vendor-phone').fill('9812345678');
  87  |   await homemakerDialog.locator('#vendor-address').fill('4, Cross Street');
  88  |   await homemakerDialog.locator('#vendor-area').fill('Vadapalani');
  89  |   await homemakerDialog.locator('#vendor-speciality').fill('Tiffin, Snacks');
  90  |   await homemakerDialog.getByRole('button', { name: 'Create homemaker' }).click();
  91  |   await expect(homemakerDialog).toBeHidden();
  92  |   await expect(toasts(page).filter({ hasText: 'Homemaker created' })).toBeVisible();
  93  |   await expect(page.getByRole('cell', { name: new RegExp(homemakerName) }).first()).toBeVisible();
  94  |   await expect(page.getByRole('cell', { name: /^Chennai/ }).first()).toBeVisible();
  95  |   await expect(page.getByRole('columnheader', { name: 'Gross value' })).toBeVisible();
  96  |
  97  |   // Walk back — the Restaurants link returns to its own route.
  98  |   await page.getByRole('link', { name: 'Restaurants', exact: true }).click();
  99  |   await page.waitForURL('**/super-admin/restaurants');
  100 |
  101 |   // Detail view reveals the full contact (doc 15: reveal on detail).
  102 |   await page.getByLabel('Search restaurants').fill(restaurantName);
  103 |   await expect(page).toHaveURL(/q=E2E/);
  104 |   await page
  105 |     .getByRole('row', { name: new RegExp(restaurantName) })
  106 |     .getByRole('button', { name: 'View', exact: true })
  107 |     .click();
  108 |   await expect(page).toHaveURL(/vendor=/);
  109 |   const detail = page.getByRole('dialog');
  110 |   // The dialog title also carries the verification/status badges.
  111 |   await expect(detail.getByRole('heading', { name: new RegExp(restaurantName) })).toBeVisible();
  112 |   await expect(detail.getByText('9876543210')).toBeVisible();
  113 |
  114 |   // Opening-hours editor (doc 22 form field, doc 39 W4 "Hours set").
  115 |   await detail.getByRole('tab', { name: 'Commission & hours' }).click();
  116 |   await expect(detail.getByText('Opening hours are not set yet.')).toBeVisible();
  117 |   await detail.getByRole('button', { name: 'Edit hours' }).click();
  118 |   await detail.getByRole('switch', { name: 'Open on MON' }).click();
  119 |   await detail.getByRole('button', { name: 'Save hours' }).click();
  120 |   await expect(toasts(page).filter({ hasText: 'Opening hours saved' })).toBeVisible();
  121 |   await expect(detail.getByText('09:00 – 22:00').first()).toBeVisible();
  122 |
  123 |   // Documents tab (SA-2.1, docs 11/22): presigned upload against MinIO,
  124 |   // then the private file is readable only through the signed viewer.
  125 |   await detail.getByRole('tab', { name: 'Documents' }).click();
  126 |   await detail.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/fssai.png');
  127 |   await expect(toasts(page).filter({ hasText: 'FSSAI document uploaded' })).toBeVisible();
  128 |   const fssaiRow = detail.locator('li').filter({ hasText: 'FSSAI' });
  129 |   await expect(fssaiRow).toBeVisible();
  130 |   await expect(fssaiRow.getByText('Pending')).toBeVisible();
  131 |
  132 |   await fssaiRow.getByRole('button', { name: 'View' }).click();
  133 |   const viewer = page.getByRole('dialog').filter({ hasText: 'FSSAI document' });
  134 |   await expect(viewer.getByRole('img')).toBeVisible();
  135 |   await viewer.locator('button').filter({ hasText: 'Close' }).click();
  136 |   await expect(viewer).toBeHidden();
  137 |
  138 |   // Verify (note optional) flips the row badge through the audit path.
  139 |   await fssaiRow.getByRole('button', { name: 'Verify' }).click();
  140 |   await page.getByRole('button', { name: 'Verify document' }).click();
  141 |   await expect(toasts(page).filter({ hasText: 'FSSAI document verified' })).toBeVisible();
  142 |   await expect(fssaiRow.getByText('Verified')).toBeVisible();
  143 | });
  144 |
```
