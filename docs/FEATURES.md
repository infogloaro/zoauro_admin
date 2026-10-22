# ZOAURO Admin Panel: features built (as of 2026-10-22)

What the code does today, module by module, for the two panels: **Super Admin** (`/super-admin/...`, every zone) and **Zonal Admin** (`/zone/...`, only the zones and actions the Super Admin granted). Every list has search, filters, sorting, paging and a zone chip when more than one zone is in view; every write is audited; zone scoping is enforced on the server. The decisions behind each feature are in `A-product/03_Business_Rules_and_Decision_Register.md` (D-numbers below); the change history is in `E-quality-ops/32_Technical_Debt_and_Change_Log.md`; how to show it all is `F-execution/61_Demo_Script.md`.

Status: **Built** = API and screens; **API only** = no screen yet; **Paused** = built in part, frozen until after the demo; **Not built**.

## 1. Sign-in and accounts
| Feature | Status | Notes |
|---|---|---|
| Sign-in for both roles, password reset by email link, change password, first-login password change | Built | |
| 2-step verification: authenticator app, email code, SMS code (SMS off until the MSG91 account and DLT IDs exist, D68), backup codes, "remember me" | Built | policy in Settings > Security |
| Sessions: list and sign out other devices; new sign-in and password-changed emails | Built | |
| 2-step recovery by the Super Admin, and a server command for the last Super Admin | Built | `cli mfa:reset` |

## 2. Super Admins and access (D41, D178)
| Feature | Status | Notes |
|---|---|---|
| Primary Super Admin and delegated Super Admins with Control Panel areas | Built | `/super-admin/super-admins` |
| Zonal Admin accounts, zone teams, access profiles, per-member GRANT/DENY overrides and refund limits per zone | Built | `/super-admin/zonal-admins`, `/access/*` |
| Access requests (zonal asks, Super Admin approves or rejects) and the access change history | Built | |
| Record claims: an onboarding record is claimed while someone works on it, with takeover requests (D174) | Built | |

## 3. Zones (M02)
| Feature | Status | Notes |
|---|---|---|
| Zones with pincode ranges, delivery charge, colour, status (upcoming, active, inactive), services per zone (restaurants, home food, hotel booking) | Built | |
| Activation checks, impact preview before changes, delete only without history | Built | |
| Zone resolution by pincode for the apps | API only | through the Integration API |

## 4. Vendors and onboarding
| Feature | Status | Notes |
|---|---|---|
| Restaurants, shops (restaurants of kind SHOP) and Home Food (homemakers): add, edit, documents, verification, status, commission, move zone, reveal contact | Built | |
| Vendor onboarding queue: submitted, under review (claimed), more information required, decided; age colours (D170) | Built | `/vendor-onboarding` |
| Onboarding document checklist per party, set in the Control Panel (D97, D145) | Built | |
| Hotels: hotels, room bookings, table bookings (D118, D127) | Built | |
| Vendor plans (packages): catalogue and subscriptions, trial, cancel (D188) | Built | `/vendor-plans` |

## 5. Menu
| Feature | Status | Notes |
|---|---|---|
| Menu items and categories, admin disable with reason, bulk upload | Built | |
| Food item requests from the vendor app: create, change and delete requests, approve or reject (D119, D124–D126) | Built | |

## 6. Delivery partners
| Feature | Status | Notes |
|---|---|---|
| Partners: add, documents, verification, status, force offline, move zone | Built | |
| Partner requests (sign-ups waiting for verification) | Built | |
| COD cash limit: no new cash order for a partner over the limit (D173) | Built | limit in the Control Panel |
| Automatic assignment of the nearest partner (D154) | Not built | manual assignment from the order |

## 7. Customers
| Feature | Status | Notes |
|---|---|---|
| Customers: list, detail with addresses and orders, add customer, block and unblock, reveal contact (D25, D26, D28) | Built | |
| Reward points: balance, ledger, adjust, convert to wallet, settings per zone (D169) | Built | |

## 8. Orders
| Feature | Status | Notes |
|---|---|---|
| Orders list and detail with timeline, status changes through the state machine, assign a partner (picker respects the COD limit), cancel with a configured reason (D190) | Built | |
| Order overview: open orders by stage, delayed orders, unassigned ready orders, due pre-orders, money tiles | Built | `/orders/overview` |
| Pre-orders: schedule, reschedule, dispatch sweep (D150, D167) | Built | |
| Unpaid online orders stay hidden until paid or timed out (D52, D161) | Built | |

## 9. Money
| Feature | Status | Notes |
|---|---|---|
| Refunds: requested, pending approval, second approval, approved, processed, rejected, failed; to source, wallet or UPI; vendor share (D146, D180, D187) | Built | no payment gateway yet |
| Payments list and detail | Built | read only until the gateway (D6, Razorpay parked) |
| COD settlement (cash hand-overs, cash in hand) and payouts to vendors and partners | Built | |

## 10. Operations
| Feature | Status | Notes |
|---|---|---|
| Dashboards for both roles (tiles per permission and zone) | Built | |
| Global search in the header (orders, customers, vendors, partners) (D143) | Built | |
| Notifications: messages, promotions with Super Admin approval, scheduling (D134–D137) | Built | |
| Support desk: tickets, messages, assignment, SLA timers, reopen (D139–D141) | Built | |
| Exports of every list to CSV (D129, D149) | Built | needs the worker |
| Live updates over Socket.IO (D142) | Built | |
| Audit log and sign-in history | Built | `/activity`, `/settings/logs` |

## 11. Control Panel (Super Admin settings, D144: every business value is a setting with a default)
Refund limits and rules, onboarding documents and age warnings, support response times, notification timing and channels, order number format, orders per partner, cancel reasons, COD limit, unpaid order timeout, cancellation windows, pre-order rules, auto-assign (setting only), order stage targets, payout cycle, delivery charge cap, commission edit for Zonal Admins, record claim timing, "remember me" sessions, SMS provider, reward points, 2-step policy. Many can be overridden per zone; the change history is kept. Screen: `/super-admin/control-panel` and `/super-admin/settings/*`.

## 12. Integration with the apps (D147)
| Feature | Status | Notes |
|---|---|---|
| Integration API framework: signed requests, scopes, rate limits, idempotency, request log, API client creation from the server command line | Built (API) | `cli client:create` |
| Vendor and partner sign-up from the apps, zone by pincode, "Needs a zone" | Built (API) | |
| Documents with sign-ups, orders from the customer app, menu sync, partner events, outbound webhooks, Integration Hub screens | Paused | after the demo (IH-2b to IH-9) |

## 13. Demo stack (owner, 2026-10-21)
Separate `zoauro_demo` database with full sample data, run from a frozen build of committed code. Start and stop by double-click: `apps/api/scripts/demo/Start-ZOAURO-Demo.cmd` and `Stop-ZOAURO-Demo.cmd`. Commands: `demo:build`, `demo:db`, `demo:reset`, `demo:data`. Sign-in codes of the demo logins are also copied to the presenters' inboxes (demo only). Details: `F-execution/61_Demo_Script.md`.

## 14. Not built yet
Payment gateway (Razorpay, D6), automatic partner assignment (D154), map-based zones (PostGIS, D164), multi-restaurant checkout (D181), ads and offers modules, the Integration Hub screens, production deployment.
