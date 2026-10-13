# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: zone-management.spec.ts >> super admin manages zones end to end
- Location: tests\e2e\zone-management.spec.ts:36:5

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 45000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/super-admin/zones" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
    - main [ref=e2]:
        - generic [ref=e3]:
            - generic [ref=e4]:
                - text: ZOAURO
                - paragraph [ref=e5]: Admin panel
            - generic [ref=e6]:
                - heading "Sign in" [level=3] [ref=e8]
                - generic [ref=e9]:
                    - tablist "Account type" [ref=e10]:
                        - tab "Super Admin Full access to all zones" [selected] [ref=e11]:
                            - text: Super Admin
                            - generic [ref=e12]: Full access to all zones
                        - tab "Zonal Admin Access to assigned zone" [ref=e13]:
                            - text: Zonal Admin
                            - generic [ref=e14]: Access to assigned zone
                    - generic [ref=e15]:
                        - generic [ref=e16]:
                            - text: Email
                            - textbox "Email" [ref=e17]:
                                - /placeholder: you@zoauro.com
                                - text: admin@zoauro.test
                        - generic [ref=e18]:
                            - text: Password
                            - generic [ref=e19]:
                                - textbox "Password" [ref=e20]: Zoauro!Dev2026
                                - button "Show password" [ref=e21]
                        - generic [ref=e25]:
                            - generic [ref=e26] [cursor=pointer]:
                                - checkbox "Remember me" [ref=e27]
                                - text: Remember me
                            - generic "Available in a later task" [ref=e28]: Forgot password?
                        - alert [ref=e29]: Could not reach the server. Try again.
                        - button "Sign in" [ref=e30]
    - region "Notifications alt+T"
    - button "Open Next.js Dev Tools" [ref=e36] [cursor=pointer]
    - alert [ref=e40]
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  |
  3  | /**
  4  |  * Zone Management journey (doc 24 TC-UI-1, doc 18/20):
  5  |  * guard redirect → login → list → create → search → edit →
  6  |  * deactivate (impact-blocked) → logout → guard again.
  7  |  */
  8  |
  9  | const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@zoauro.test';
  10 | const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Zoauro!Dev2026';
  11 |
  12 | const stamp = Date.now();
  13 | const zoneName = `E2E Zone ${stamp}`;
  14 | const zoneCity = 'E2E City';
  15 | const editedCity = 'E2E City Updated';
  16 |
  17 | function toasts(page: Page) {
  18 |   return page.locator('[data-sonner-toast]');
  19 | }
  20 |
  21 | async function login(page: Page) {
  22 |   await page.goto('/login');
  23 |   await page.fill('#email', EMAIL);
  24 |   await page.fill('#password', PASSWORD);
  25 |   await page.getByRole('button', { name: 'Sign in' }).click();
> 26 |   await page.waitForURL('**/super-admin/zones');
     |              ^ Error: page.waitForURL: Test timeout of 45000ms exceeded.
  27 |   await expect(page.getByRole('heading', { name: 'Zone Management' })).toBeVisible();
  28 | }
  29 |
  30 | test('unauthenticated visitors are redirected to the login guard', async ({ page }) => {
  31 |   await page.goto('/super-admin/zones');
  32 |   await expect(page).toHaveURL(/\/login\?next=/);
  33 |   await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  34 | });
  35 |
  36 | test('super admin manages zones end to end', async ({ page }) => {
  37 |   await login(page);
  38 |   await expect(page.getByText('Total Zones')).toBeVisible();
  39 |
  40 |   // Create — Escape closes the dialog first (keyboard path), then reopen.
  41 |   await page.getByRole('button', { name: 'Add Zone' }).first().click();
  42 |   await expect(page.getByRole('dialog').getByRole('heading', { name: 'Add zone' })).toBeVisible();
  43 |   await page.keyboard.press('Escape');
  44 |   await expect(page.getByRole('dialog')).toBeHidden();
  45 |
  46 |   await page.getByRole('button', { name: 'Add Zone' }).first().click();
  47 |   const dialog = page.getByRole('dialog');
  48 |   await dialog.locator('#zone-name').fill(zoneName);
  49 |   await dialog.locator('#zone-city').fill(zoneCity);
  50 |   await dialog.locator('#zone-state').fill('Tamil Nadu');
  51 |   await dialog.locator('#zone-pincode-from').fill('600001');
  52 |   await dialog.locator('#zone-pincode-to').fill('600020');
  53 |   await dialog.locator('#zone-delivery-charge').fill('49');
  54 |   await dialog.getByRole('button', { name: 'Create zone' }).click();
  55 |   await expect(dialog).toBeHidden();
  56 |   await expect(toasts(page).filter({ hasText: 'Zone created' })).toBeVisible();
  57 |   await expect(page.getByRole('cell', { name: new RegExp(zoneName) }).first()).toBeVisible();
  58 |
  59 |   // Search filters to the new zone (URL-synced q, doc 20/22).
  60 |   await page.getByLabel('Search zones').fill(zoneName);
  61 |   await expect(page).toHaveURL(/q=E2E\+Zone/);
  62 |   const rows = page.getByRole('row');
  63 |   await expect(rows).toHaveCount(2); // header + one match
  64 |
  65 |   // Edit — prefilled dialog, save updates the row.
  66 |   await page.getByRole('button', { name: `Edit ${zoneName}` }).click();
  67 |   const editDialog = page.getByRole('dialog');
  68 |   await expect(editDialog.getByRole('heading', { name: 'Edit zone' })).toBeVisible();
  69 |   await expect(editDialog.locator('#zone-name')).toHaveValue(zoneName);
  70 |   await editDialog.locator('#zone-city').fill(editedCity);
  71 |   await editDialog.locator('#zone-delivery-charge').fill('79');
  72 |   await editDialog.getByRole('button', { name: 'Save changes' }).click();
  73 |   await expect(editDialog).toBeHidden();
  74 |   await expect(toasts(page).filter({ hasText: 'Zone updated' })).toBeVisible();
  75 |   await expect(page.getByRole('cell', { name: editedCity })).toBeVisible();
  76 |
  77 |   // Deactivate — impact check incomplete (F1.1 pending) → 409, zone stays Active.
  78 |   await page.getByRole('button', { name: `More actions for ${zoneName}` }).click();
  79 |   await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  80 |   const deactivateDialog = page.getByRole('dialog');
  81 |   await expect(deactivateDialog.getByRole('heading', { name: `Deactivate ${zoneName}?` })).toBeVisible();
  82 |   await expect(deactivateDialog.getByText('Impact check incomplete')).toBeVisible();
  83 |   await deactivateDialog.getByRole('button', { name: 'Deactivate zone' }).click();
  84 |   await expect(deactivateDialog.getByRole('alert')).toContainText('Deactivation blocked');
  85 |   await deactivateDialog.getByRole('button', { name: 'Cancel' }).click();
  86 |   await expect(deactivateDialog).toBeHidden();
  87 |   await expect(page.getByRole('cell', { name: 'Active' })).toBeVisible();
  88 |
  89 |   // Logout via the user menu, then the guard redirects again.
  90 |   await page.locator('header button:not([aria-label])').click();
  91 |   await page.getByRole('menuitem', { name: 'Log out' }).click();
  92 |   await expect(page).toHaveURL(/\/login/);
  93 |   await page.goto('/super-admin/zones');
  94 |   await expect(page).toHaveURL(/\/login\?next=/);
  95 | });
  96 |
```
