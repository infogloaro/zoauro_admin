# 61 — Demo Script (admin panel, sample data)

Version 0.2, 2026-10-21 (demo accounts, zones and start commands from the demo seed). Owner: docs lane. Demo planned for the end of 2026-10-22 (D188).

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

1. Close other heavy programs. The machine has 7.75 GB of RAM; only Docker, the demo API and the demo web app should run during the demo. Stop all build sessions an hour before (D189).
2. From the repo root, with Docker running:

   | Step | Command | When |
   |---|---|---|
   | Services (Postgres, Redis, MinIO, Mailpit) | `pnpm infra:up` | Every time |
   | Demo settings file `apps/api/.env.demo` (git-ignored) | `pnpm --filter @zoauro/api demo:env` | Once |
   | Frozen production build of the committed code into `D:\GloAro pvt lmt - PR\zoauro-demo-build` (pin a commit with `demo:build -- --commit <sha>`; 3–5 minutes) | `pnpm --filter @zoauro/api demo:build` | After the final push |
   | Create and migrate `zoauro_demo` and the `zoauro-demo` bucket | `pnpm --filter @zoauro/api demo:db` | First time only |
   | Demo API on port 4100 (terminal 1, built API) | `pnpm --filter @zoauro/api demo:api` | Every time |
   | Demo web app on port 3100 (terminal 2, built web) | `pnpm --filter @zoauro/api demo:web` | Every time |
   | Sample data (re-runnable, skips what exists) | `pnpm --filter @zoauro/api demo:data` | Once the API is up |
   | Fresh sample data after a rehearsal | stop `demo:api` (Ctrl+C), run `pnpm --filter @zoauro/api demo:reset`, start `demo:api`, run `demo:data` | Before the real demo |

   The demo runs from the frozen build, never from the shared working folder, so unfinished work in other sessions cannot break it. Pages load in about a second.

   To stop a server, press Ctrl+C in its terminal. If one was started in the background, Windows keeps the port busy: run `netstat -ano | findstr :4100` (or `:3100`) and end that process.

3. The demo uses only `zoauro_demo`; the real `zoauro` database is never touched (D188).
4. Check `http://127.0.0.1:4100/api/ready` shows database and Redis `ok`. The first check after a quiet spell can say "database down" for a moment; check again.
5. Open the panel at **`http://127.0.0.1:3100`**. Use `127.0.0.1`, not `localhost`, so it doesn't share sign-in cookies with the development app.
6. Open Mailpit at `http://127.0.0.1:8025` in a second tab. Two-step sign-in codes arrive there; the demo API sends every email to Mailpit only.
7. Open `docs/F-execution/60_Admin_Workflow_Map.html` in a third tab as the backup for anything marked Design.

## 2. Logins

| Account | Email | Role | What it shows |
|---|---|---|---|
| Arun Prakash | `superadmin@zoauro.demo` | Primary Super Admin | Everything: all zones, Control Panel, access, commissions, approvals, other Super Admins |
| Meena Sundaram ("Admin") | `admin@zoauro.demo` | Super Admin, not primary, with Control Panel areas: zones, refund settings, onboarding settings, loyalty settings (D178) | All-zone operations, but only the granted Control Panel areas |
| Karthik Raj | `karthik.zonal@zoauro.demo` | Zonal Admin, two zones: Coimbatore Central (Zone Manager; refunds up to ₹500 each, ₹2,000 a day) and Coimbatore North (Operations; menu edit/delete and refunds denied; ₹200 / ₹500) | Zone switcher, restricted menu, refund limits, a pending access request for menu edit in Coimbatore North |
| Priya Venkatesh | `priya.zonal@zoauro.demo` | Zonal Admin, Coimbatore Central only, "Menu Desk" profile | A second admin in the same zone with a narrower job |
| Suresh Kumar | `suresh.zonal@zoauro.demo` | Zonal Admin, Tiruppur only, Zone Manager | One zone, no switcher; hotel booking switched off in this zone |

Passwords and authenticator secrets are in the local file `apps/api/.env.demo-credentials.json` (git-ignored, never committed). They are never written in git, docs or chat, and stay the same across re-seeds.

**Demo zones:** Coimbatore Central (CBE, pincodes 641001–641020, delivery ₹30), Coimbatore North (CBN, 641021–641035, ₹35), Tiruppur (TUP, 641601–641610, ₹40, hotel booking off), Pollachi (PLC, 642001–642008, Upcoming).

**Sample data:** 16 vendors (restaurants, a shop, Home Food) at every onboarding stage with documents; 38 menu items and 6 food item requests from the vendor app (4 pending); 9 delivery partners and 4 partner requests (1 in Needs a zone); 24 customers (2 blocked) with reward points; 586 orders over 30 days plus today's live board (28 orders in every status), 1 hidden unpaid online order and 4 pre-orders for tomorrow; 4 hotels (2 live, 1 under review, 1 rejected), 5 room bookings and 5 table bookings; 6 support tickets; notifications (one sent, one promotion waiting for approval, one scheduled); 8 refunds (2 requested, 1 waiting for approval, 1 approved, 3 processed, 1 rejected); Control Panel values with zone overrides (reward points, orders per partner, Tiruppur refund caps, commission-edit switch on).

**Actions to do live** (each uses up its sample record; reset the data after a rehearsal):
- Approve Karthik's access request (menu edit in Coimbatore North), then show his menu change.
- Approve the refund waiting for approval.
- Verify Kovai Biryani House or Arya Bhavan from the onboarding queue.
- Approve a food item request.
- Assign a READY order to a partner.
- Approve the biryani promotion.

**Signing in (every account):**
1. Open `http://127.0.0.1:3100/login`.
2. Choose the **Super Admin** tab for Arun and Meena, **Zonal Admin** for the others. The wrong tab gives the same message as a wrong password.
3. Type the email and password.
4. Choose **Email code** and type the 6-digit code from Mailpit (every demo account also has an authenticator set up).

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
