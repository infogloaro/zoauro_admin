# 58 — Manual test procedure: core modules

For the owner and testers. Covers the modules marked Done / In review in `ZOAURO_Module_Build-members.xlsx`: Login and
2-step (M01), Audit and Logs (M04), Zones (M02), Zonal Admins and Access Control (M03), the Control Panel (D92),
Security settings (M19) and the dashboards (M16). Each case lists the steps and what you must see. If something differs,
note the case number, what you did and a screenshot, and report it.

Automated checks already cover these flows (`pnpm e2e:auth`: 14 browser tests against the real API, with an
accessibility check on every screen). This manual pass checks them on your own machine and database, as a user would.

## 0. Before you start (once)

| # | Step | Expected |
|---|---|---|
| 0.1 | Start Docker Desktop. In the project folder run `pnpm infra:up` | Four containers report healthy: postgres, redis, minio, mailpit |
| 0.2 | Make sure the database is up to date. The per-zone services migration needs the owner's "approved" in the backend session first; then that session applies it | The Control Panel opens without an error (case 6.1) |
| 0.3 | Run `pnpm dev` | The API prints `api listening on :4000`; the web app is on http://localhost:3000 |
| 0.4 | Open Mailpit at http://localhost:8025 in another tab | The inbox opens; every email the panel sends (codes, resets, notices) arrives here |
| 0.5 | If you have no Super Admin yet: `pnpm --filter @zoauro/api demo:seed --email <your email>` in a terminal (add `--dry-run` first to preview). It asks for a password without showing it | It prints the account it created; nothing is printed about the password |
| 0.6 | Keep a phone with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) for case 1.4 | |

## 1. Login and 2-step (M01)

| # | Step | Expected |
|---|---|---|
| 1.1 | Open http://localhost:3000 | You are sent to the sign-in page: food photo on the left, white card on the right, "Welcome back" |
| 1.2 | Choose **Zonal Admin**, type the Super Admin email and correct password, sign in | "The email or password is not correct." The wrong tab gives the same message as a wrong password |
| 1.3 | Choose **Super Admin**, correct email and password | First time: "Set up 2-step verification" with method cards; Authenticator and SMS are disabled with "Add it after you sign in" |
| 1.4 | Click **Email code**, then **Send code**. Open Mailpit, copy the 6-digit code, type it | The code is accepted; 10 backup codes are shown |
| 1.5 | Try **Finish and sign in** without ticking the box | The button stays disabled |
| 1.6 | Copy or download the backup codes, tick "I have saved these codes", **Finish and sign in** | You land on the Super Admin dashboard: "Good morning/afternoon/evening, <name>" |
| 1.7 | Open the user menu (top right) → **Account security** → **Add authenticator app** → **Start**, type your password | A QR code and a typed key appear |
| 1.8 | Scan the QR with your phone, type the 6-digit code from the app | "Method added." The authenticator is listed with email codes |
| 1.9 | Sign out (user menu → Sign out). Sign in again | The 2-step page shows the method cards; nothing is sent until you pick one |
| 1.10 | Pick **Authenticator app**, type the code from your phone | Dashboard |
| 1.11 | Sign out, sign in, pick **Email code** | "We sent a code to …"; the code from Mailpit works |
| 1.12 | Sign out, sign in, choose **Use a backup code**, type one of the saved codes | Signed in. The same backup code never works twice; Mailpit has a "backup code used" notice |
| 1.13 | Sign out. On the sign-in page enter the right email with a wrong password 5 times | From the 2nd failure the lock rule is explained; after the 5th, even the right password is refused for 30 minutes |
| 1.14 | Use **Forgot password?** on another account (or after the lock expires) | "If that email belongs to an account…"; Mailpit has the reset link; the link lets you set a new password once; the 2-step is still asked after |
| 1.15 | Tick **Remember me for 7 days** when signing in, close the browser, open it again | Still signed in |
| 1.16 | Sign in from a second browser. In Account security → Active sessions, sign out the other session | The other browser is sent to sign-in on its next click |
| 1.17 | In Account security, try **Remove** on a method or **Generate new backup codes** | It asks for your password and a code first (step-up) |

## 2. Zones (M02)

| # | Step | Expected |
|---|---|---|
| 2.1 | Sidebar → Zone Operations → **Zone Management** | Count cards (total, active, inactive, upcoming), search, filters, table |
| 2.2 | **Add zone**: name "Test Adyar", code "TADY", city Chennai, state Tamil Nadu, delivery charge 25, add pincode 600020, **Create zone** | The zone page opens, status Upcoming, 1 pincode, ₹25.00 |
| 2.3 | Add another zone with pincode 600020 again | The chip turns red: "in Test Adyar"; saving is refused with "belong to another zone" |
| 2.4 | Remove that pincode, use 600021, create | Created |
| 2.5 | Try to change the code in **Edit** | The code field is disabled ("Fixed: it appears in order numbers and exports") |
| 2.6 | Type a range from 600000 to 603000 | "A range may hold at most 2,000 pincodes (this one has 3,001)" |
| 2.7 | **Activate** the zone, type your password | "<zone> is live"; status Active |
| 2.8 | **Deactivate**: see the impact table, type a reason shorter than 10 characters, then a proper reason and tick the box | The button enables only with a 10+ character reason and the box; then "paused", and the reason shows on the zone page |
| 2.9 | Pincodes tab: add 600030 → **Preview** → **Save** | Preview shows "+1 added"; after Save the pincode is in the list |
| 2.10 | Activity tab | The create, activate, deactivate and pincode changes are listed with who did them |
| 2.11 | **Delete** a zone that has only been created (never live) | Deleted; its code cannot be reused; deleting a zone with history is refused |

## 3. Zonal Admins and Access Control (M03)

| # | Step | Expected |
|---|---|---|
| 3.1 | Sidebar → Administration → **Zonal Admins** → **Add Zonal Admin**: name, a second email you can read in Mailpit, **Generate a strong password** (copy it), **Create account** | The member's access page opens |
| 3.2 | **Add zone** → pick a zone and the "Zone Manager" profile → **Save** → password | "Access saved"; the preview shows the member's permissions, limits and the modules they will see |
| 3.3 | In the grid, set one cell to **Deny** (e.g. Orders: edit), save | The preview marks it denied; deny always wins over the profile |
| 3.4 | Try a cell marked with a lock (e.g. Zones) | It is disabled: "Never grantable to a Zonal Admin" |
| 3.5 | Set a per-refund limit of ₹2,000, save | Saved; the preview shows ₹2,000 |
| 3.6 | Open a private window, sign in as the new member on the **Zonal Admin** tab with the temporary password | Forced password change first, then email-code set-up, then their dashboard showing only their zone(s), permissions and limits |
| 3.7 | As the member, open http://localhost:3000/super-admin/zonal-admins | "Page not found" (Super Admin pages do not exist for them) |
| 3.8 | Back as Super Admin: Access Profiles → open "Zone Manager" → untick one action → **Save** | It first says "This changes access for N members"; after the password, the member's access changes on their next click |
| 3.9 | Zonal Admins → the member's menu → **Suspend** → password | Their open session ends; they cannot sign in until **Reactivate** |
| 3.10 | **Reset password** (generate one) | All their sessions end; Mailpit has a notice that does NOT contain the password; they must change it at next sign-in |
| 3.11 | **Zone Teams**: pick the zone | The member is listed with profile and limits; **Add member** / **Remove** work with your password |
| 3.12 | **Access History** | Every change above is listed with before/after |
| 3.13 | **Delete** the member | Removed from the lists; the history stays |

## 4. Audit and Logs (M04)

| # | Step | Expected |
|---|---|---|
| 4.1 | Overview → **Recent Activities** | Today's actions grouped by day; filters "Denied attempts" and "Sensitive" |
| 4.2 | Click a row | A drawer shows what changed, before and after |
| 4.3 | Administration → **Audit & Logs** | System Logs with filters (date, module, action, zone, actor, outcome) and the zone you created in the rows |
| 4.4 | **Sign-ins** tab | Successful and failed sign-ins from section 1, emails masked |
| 4.5 | Failed attempts from 1.13 | Listed as failures; a locked account shows as "Account locked" in the logs |
| 4.6 | "Access change history" link at the top | Opens Access History |

## 5. Security settings (M19) and dashboards (M16)

| # | Step | Expected |
|---|---|---|
| 5.1 | Administration → **Security Settings** | 2-step policy, allowed methods, code rules, sign-in rules in effect, security status |
| 5.2 | Change "Code valid for" to 240 → **Save changes** | Asks for your password AND a code; "Security policy saved"; the value stays after a reload |
| 5.3 | Set a value outside its range (e.g. 1000) | The field turns red with "Between 120 and 600"; Save stays disabled |
| 5.4 | Dashboard | Real numbers only: zones by status, latest zones, 2-step coverage, recent activity, module progress. Order and money tiles appear when those modules exist |
| 5.5 | Top bar: press Ctrl+K, type "zone" | The page finder lists Zone Management; Enter opens it |
| 5.6 | Click the arrow next to the logo area | The sidebar folds to icons and stays folded after a reload |

## 6. Control Panel (D92)

| # | Step | Expected |
|---|---|---|
| 6.1 | Administration → **Control Panel** | Every zone × Restaurants, Home Food, Hotel Booking; Hotel Booking is off by default |
| 6.2 | Switch **Hotel Booking** on for a zone, type your password | "Hotel Booking on in <zone>"; the count card updates |
| 6.3 | Switch it off | A confirmation explains that new onboarding and orders stop; after "Switch off" and the password it is off |
| 6.4 | Open the zone → **Services** tab | The switch, and "Changed by <you>, <time>" |
| 6.5 | Platform settings card | The decided defaults (refund limits, documents, SLAs, promotion hours, order number, SMS provider), marked Soon |

## 7. What is not in this pass

Restaurants, Home Food, Orders (with the colleagues), Menu, Customers, Delivery Partners, Payments, Refunds, Payouts,
Support, Notifications and Hotel Booking are not built yet: their menu entries open a plan page marked Soon. SMS codes
stay off until the MSG91 DLT template is registered.
