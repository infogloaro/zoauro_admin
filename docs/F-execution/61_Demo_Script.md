# 61 — Demo Script (admin panel, sample data)

Version 0.1, 2026-10-21. Owner: docs lane. Demo planned for the end of 2026-10-22.

The demo shows the ZOAURO admin panel with **sample data only**: no live app data, no app integration, no payment gateway (Razorpay keys are pending from management). It walks through what each role sees and controls, how the main flows work, and how the Super Admin changes business rules from the Control Panel without code changes.

Each step carries a tag so the presenter never clicks into something unfinished:

| Tag | Meaning |
|---|---|
| **Ready** | Built and working on main today |
| **Today** | Planned to land on 2026-10-21 |
| **Tomorrow** | Planned to land on 2026-10-22 morning |
| **Design** | Not built; show the workflow map (`60_Admin_Workflow_Map.html`) or doc 60 instead |

Update the tags after each push wave. Before the demo, rehearse once and change any step that is not Ready to Design.

## 1. Before the demo

1. Close other heavy programs. The machine has 7.75 GB of RAM; only the database containers, the API and the web app should run during the demo. Stop the build sessions an hour before.
2. Start the services: Postgres, Redis, MinIO and Mailpit (`pnpm infra:up`). Use `127.0.0.1` for local services.
3. Point the API at the demo database `zoauro_demo`, never at `zoauro`. The demo seed (intake lane) creates the data and prints the demo passwords once in its own window; keep them out of git, docs and chat.
4. Start the API and the web app (`pnpm dev`). Check `http://127.0.0.1:4000/api/ready` shows database and Redis `ok`, and that `http://localhost:3000/login` opens.
5. Open Mailpit at `http://localhost:8025` in a second tab. Two-step sign-in codes arrive there.
6. Open `docs/F-execution/60_Admin_Workflow_Map.html` in a third tab as the backup for anything marked Design.

## 2. Logins

| Account | Role | What it shows |
|---|---|---|
| Primary Super Admin | Super Admin (primary) | Everything: all zones, Control Panel, access, commissions, approvals, other Super Admins |
| Admin | Super Admin with only some Control Panel areas granted (D178) | All-zone operations, but only the Control Panel areas the primary granted |
| Zonal Admin | Zonal Admin with two zones and a limited profile | Zone switcher, restricted menu, refund limits, asking for more access |
| Zonal Admin (one zone), optional | Zonal Admin with one zone | Contrast: a single zone, no switcher |

Account emails and zone names are filled in here once the seed is fixed. Passwords are never written down here.

**Signing in (every account):**
1. Open `http://localhost:3000/login`.
2. Choose the **Super Admin** tab for the first two accounts, **Zonal Admin** for the others. The wrong tab gives the same message as a wrong password.
3. Type the email and password.
4. First sign-in only: confirm the email with the code from Mailpit, then save the 10 backup codes (tick "I have saved these codes").
5. Later sign-ins: type the 6-digit code from Mailpit.

Talking point: there is no Google sign-in, 2-step is required for both roles, and 5 wrong attempts lock the account for 30 minutes.

## 3. The story

Each act names the screen (menu path), what to do, and what to say. Times are a guide for a 60-minute demo.

### Act 0. What ZOAURO admin is (3 min) — Design
- Workflow map, section 01 "System flow": customer, vendor and partner apps send data in; admins decide; decisions go back to the apps.
- Section 02 "Navigation map": two roles, one panel; the Zonal Admin menu is built from permissions.

### Act 1. Super Admin: dashboard and zones (5 min)
Sign in as the **Primary Super Admin**.
1. **Dashboard** — Today. Tiles for orders, vendors, partners, customers and pending work; charts by status and zone.
2. **Zone Operations → Zone management** — Ready. Zones with pincodes, team, counts. Open one zone: Overview, Pincodes, Services, Team, Activity.
3. **Add zone** — Ready. Name, code, city, pincodes, delivery charge. A pincode that already belongs to another zone is refused and names that zone.
4. **Activate / deactivate** — Ready. The impact table shows what changes; open orders always finish.

### Act 2. Control Panel: rules without code (8 min)
1. **Administration → Control Panel** — Ready. Services switched on or off per zone (Restaurants, Home Food, Hotel).
2. **Platform settings** — Ready. Every business rule is a setting with a default, and a zone may override it:
   - refund rules: reasons, who pays, cancellation windows (D146, D180);
   - refund limits per member per zone;
   - payout cycle, 7 days by default (D152);
   - unpaid online order timeout, 15 minutes (D161);
   - delivery charge cap, ₹1,000 (D165);
   - onboarding documents per vendor type, mandatory or optional (D145);
   - reward points (D169); orders a partner carries at once (D121); auto-assign settings (D154, off).
3. Change one value (for example the payout cycle for one zone): preview → reason → password → saved.
4. **Settings history** — Ready. The change you just made, with who, why, before and after.

Talking point: management can change prices, limits and rules any time, per zone, with an audit trail.

### Act 3. People and access (8 min)
1. **Administration → Zonal admins** — Ready. Add a Zonal Admin (name, email, mobile, temporary password).
2. **Member access** — Ready. Add a zone with an access profile; set refund limits; grant or deny single actions (deny wins); reveal and export switches; **Preview** shows exactly which menu and tiles the member will see.
3. **Access profiles** — Ready. The permission matrix; Super Admin-only rows are locked.
4. **Zone teams** and **Access history** — Ready. Who works where; every access change with before and after.
5. **Super Admins** — Ready (panel) / Today (granted areas, D178). The primary creates another Super Admin and grants only some Control Panel areas.
6. **Commission** — Ready. Set on the vendor by the Super Admin; a Zonal Admin can edit it only where the Super Admin enables it (D155).

### Act 4. Vendors: onboarding and managing (10 min)
1. **Requests & approvals → Vendor onboarding** — Today. One queue for Restaurants, Shops and Home Food (cloud kitchens are Home Food, D168); stages Submitted, Under review, More info, Decided; waiting-time colours at 24 h and 48 h; Needs a zone (Super Admin only).
2. Open a submitted vendor — Ready. Check each document (FSSAI, GST, PAN, bank): view, accept or reject with a note. Then **Verify** (or **Reject** with a reason, or **Ask for more info** — Today).
3. **Activate** — Ready. Only a verified vendor can go live. Suspend stops new orders; open orders finish.
4. **Service Management → Restaurants / Home Food** — Ready. Status tabs with counts, search, masked phone and email; **Reveal** is audited.
5. **Menus & food items** — Ready. Items, categories, stock, admin disable, bulk price change (all or nothing).
6. **Food item requests** — Ready. A vendor's price or name change waits for approval; the old value stays live until approved.

### Act 5. Hotels (5 min)
1. **Hotels** — Ready. Hotels with rooms and capacity; room bookings (no overbooking); table bookings.
2. **Pre-orders** — Today. An order for a chosen time and place; dispatch starts at the right moment; reschedule or cancel.
3. **Claim / lock** — Today. While one admin handles a hotel, another sees an alert and can request a takeover (D174).

### Act 6. Orders and delivery partners (8 min)
1. **Orders** — Ready. Status tabs with counts, filters (payment method, vendor type, date), zone column.
2. Open an order — Ready. Items, payment, customer, timeline with who did each step; move the status; **Assign partner** (only partners in the same zone, under their limit); **Cancel** with a reason. A second admin changing the same order gets "This record changed. Reload".
3. **Order overview** — Tomorrow. Open, delayed and unassigned orders, cancellations and average times.
4. **Delivery partners** and **Delivery partner requests** — Ready. Verify documents, activate, force offline; cash in hand.

### Act 7. Customers (4 min)
1. **Customers** — Ready. List and detail for both roles; addresses, orders, masked contact with audited reveal; block or unblock.
2. **Reward points** on the customer — Today. Balance and history; grant or deduct with a reason.

### Act 8. Money: refunds, payments, payouts (8 min)
No payment gateway in the demo: refunds are processed manually or to the customer's wallet.
1. **Refunds** — Today. Raise a refund on an order (full, partial or goodwill, with a reason). Within the member's limit it is approved at once; above it, it waits in the Super Admin approval queue; the requester can never approve their own.
2. **Payments, COD cash, payouts** — Tomorrow (read-only lists on sample data). Payments by method (UPI, card, COD, wallet); "Refund processing" status; partner cash to settle; the weekly payout with the vendor-fault refund deducted.
3. Talking point: Razorpay connects when management provides the keys; the flow and rules are already in place.

### Act 9. Packages (4 min)
1. **Packages** — Tomorrow. The Super Admin plan catalogue: create and edit plans, features and prices; vendors on each plan.
2. Customer weekly and monthly meal plans — Design (doc 60 §10.5).

### Act 10. Support and notifications (4 min)
1. **Support desk** — Today. Tickets with SLA timers and assignment; a separate support team (D175).
2. **Notifications** — Ready. Compose to a zone or audience, schedule, promotion approval, quiet hours.

### Act 11. The Zonal Admin view (6 min)
Sign out; sign in as the **Zonal Admin** on the Zonal Admin tab.
1. The menu shows only modules this member may open; no Control Panel, zones or access screens.
2. **Zone switcher** — Ready. "All my zones" or one zone; every list and tile follows it.
3. Try a refund above the member's limit — Today. It goes to the Super Admin for approval.
4. **Access requests** — Ready. Ask for a zone or more access with a reason. Switch back to the Super Admin, approve it (password), and show the member's menu change.

### Act 12. The "Admin" view (3 min)
Sign in as the **Admin** (Super Admin with granted areas) — Today. All-zone operations, but the Control Panel shows only the granted areas.

### Act 13. Audit trail (2 min)
**Administration → Audit & logs** — Ready. Every action from this demo is listed: who, what, which zone, before and after, denied attempts.

### Act 14. What comes next (3 min) — Design
From the workflow map and doc 60: app integration (customer, vendor, partner apps), Razorpay payments, advertising and commission, customer meal plans, offers, maps and automatic partner assignment, multi-restaurant checkout.

## 4. If something breaks
- A screen errors: say it is the next build step, switch to the workflow map tab and show the same screen's layout and flow there.
- Sign-in code missing: refresh Mailpit; the code is valid for 5 minutes.
- The whole app is slow: the machine is short of memory; close everything except the browser, the API, the web app and Docker.
