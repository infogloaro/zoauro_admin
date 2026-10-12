# 37 — Design Reconciliation and Screen Inventory

Sources compared: designer PDF ("Final Documentation"), 17 Figma screenshots (zoauro.zip; one extra file is a blank 3×3 image), pre-dev pack v1.0. The Figma prototype link could not be opened from this environment (no access to that file), so screens not in the zip are marked **not seen**.

## 1. Screens received vs the PDF's 29-screen checklist
| PDF checklist screen | Screenshot? | Notes |
|---|---|---|
| Login / Role Selection | seen in the later Figma design file | Login card has Super Admin / Zonal Admin tabs, kept (D46); Google login removed (D42); "Gocart" copy to be corrected (D48) |
| Super Admin Dashboard | yes | richer than PDF (12 KPIs, revenue chart, categories, registrations, platform health) |
| Zonal Admin Dashboard | yes | differs from PDF (no Today's Revenue; has top restaurants, area chart, recent lists) |
| Orders (SA + ZA) | yes, both | |
| Order Details | not seen | |
| Restaurants (SA + ZA) | yes, both | |
| Menu / Food Items | yes (SA) | |
| Homemakers | yes (ZA only) | In SA it is a tab on the Restaurants page |
| Customers (SA + ZA) | yes, both | |
| Delivery Partners (SA + ZA) | yes, both | |
| Payments | not seen | |
| Analytics | yes (SA) | |
| Offers & Coupons | yes (SA) | |
| Reviews & Ratings | yes (SA) | |
| Notifications | not seen | |
| Settings – General, Business, Payment, Order, User Mgmt, Notifications, Integrations, System Logs | not seen | |
| Settings – Security | yes | |
| Zone Management | yes | |
| Add/Edit Zone | not seen | |
| Zonal Admin Management, Add/Edit Zonal Admin | not seen | |
| Roles & Permissions | not seen | |
| Support | not seen (in sidebar only) | |
Not seen: 16 of 29. For these, build from docs 20/22 and mark "provisional" until the designer sends frames.

## 2. Discrepancies found
| # | Figma / PDF shows | Pack v1.0 said | v1.1 resolution |
|---|---|---|---|
| 1 | Zonal sidebar zone card has a dropdown chevron | One zone per admin | Becomes the scope switcher (doc 18 §4, 36) |
| 2 | Zone Management has a State column/filter and an "Upcoming" status; one "Zonal Admin" name per row | No state; Active/Inactive; one admin | Added (D35); admin stack (D7) |
| 3 | Restaurants have Verification (Verified/Pending/Rejected) AND Status (Active/Pending/Suspended/Inactive) | Single status; rejection leaves Pending | Two fields (D22) |
| 4 | Restaurants page tabs: Restaurants / Home Makers / Hotels / Restaurants Revenue | Two vendor types | Hotels out (D23); Revenue = Finance tab |
| 5 | Super Admin sidebar has no Homemakers entry; "Zone Administration" group | Homemakers entry; separate Zone items | Tab in Restaurants (D27); group name adopted |
| 6 | Zonal dashboard: no Today's Revenue; Customers card; Zone Wise Orders bar by area; Top Performing Restaurants; Recent Restaurants/Partners/Customers | PDF: Today's Revenue, Order Status only | Both: 6 KPI cards incl. Today's Revenue (confirm), plus Figma widgets (doc 35 ZA-5.2) |
| 7 | Super Admin dashboard adds Pending Verification, Suspended, Restaurant Payouts, Avg Order Value, Cancellation Rate, Top Food Categories, New Registrations, Platform Health (uptime) | PDF KPI list shorter | Built per Figma; Platform Health limited to DB values (D34) |
| 8 | Orders payment shows "Online (UPI)", "Online (Card)", COD, **Wallet** | ONLINE / COD | WALLET + sub-method (D24) |
| 9 | Orders KPI "Pending Orders" | Status PLACED | Label mapping (D39) |
| 10 | Lists show full phone numbers and emails | Mask in lists | Mask + reveal (D26) |
| 11 | Customers: Add Customer, Registration Source, User Type, Blocked | No add; no source | Added (D28), `source` column |
| 12 | Menu items: Out of Stock tag, Import button, Featured toggle | Import not specified | Out of stock = stock 0; import P1 |
| 13 | Security: lock 30 min, session 30 min, SMS OTP (shown disabled; built behind a provider interface, off until provider + DLT exist, D67), multi-session, remember me toggles | Lock 15 min | 30 min default (D37) |
| 14 | Login activity roles: Super Admin, Admin, Support Staff, Finance Staff | Two roles | Custom roles P1 (D30) |
| 15 | Header theme toggle, "Need Help? Contact Support" card, bell with badge, global search | Not in docs | P2 / static / alerts feed / P1 (D32, D33) |
| 16 | Brand logo reads ZOAURO; Zone page subtitle says "GloAro Mart" | "GloAro" | D21 |
| 17 | Zone list shows per-zone restaurants, homemakers, partners, customers counts | Not in schema | Derived counts |
| 18 | PDF permission matrix has 4 columns | 5 (adds Status) | Designer to add column (D29) |
| 19 | PDF: Customers Add "—", Delete "Restricted" | D2: full control | D2 wins; defaults editable (doc 04) |
| 20 | Zonal "Payments" absent from Figma sidebar | Doc 18 assumed Payments | D36 open |
| 21 | Zone chart dots/colors per zone | — | `zones.color_hex` |
| 22 | Dates in Zonal screens read 2024, Super Admin 2026 | — | Mock data only; ignore |

## 3. Design tokens (approximate, from screenshots — replace with exact Figma values in F0.6)
| Token | Value (approx.) |
|---|---|
| Sidebar | dark navy `#0D1527` (PDF says navy/blue gradient) |
| Active item, Zonal | orange (≈ `#FF5A1F`) |
| Active item, Super Admin | blue (≈ `#2F6BFF`) |
| Workspace background | light neutral grey |
| Cards | white, radius ≈ 12 px, soft shadow |
| Status | Delivered/Active/Verified/Paid = green; Preparing/Pending = orange/blue-tint; Out for Delivery = amber; Cancelled/Suspended/Failed = red; Inactive = grey; Flagged = red-tint |
| Typography | Inter-like sans (confirm in Figma) |
| Money format | Indian grouping `₹12,48,320` |

## 4. Gap list to send the designer
1. Missing frames listed in §1.
2. Multi-select "Assign Zones" in Add/Edit Zonal Admin; admin stack in Zone Management.
3. Zone switcher dropdown (open state, single-zone static state), Zone column/ZoneChip in zonal lists, Zone required field in create forms, `/zone/no-zones`, "no longer available" state.
4. Zonal Payments (or refund panel in Order Details) and COD cash-settlement screen.
5. Fifth "Status" column in the permission matrix.
6. Masked contact with reveal interaction.
7. Decide: Hotels tab, theme toggle, Today's Revenue on Zonal dashboard.
8. Correct brand copy (GloAro Mart → ZOAURO) and one consistent date range.

## 5. Screen inventory (build checklist)
| Screen | Route | Primary APIs | Permission | Phase SA / ZA |
|---|---|---|---|---|
| Login, forgot/reset, 2FA | /login … | /auth/* | public | F2.6 |
| SA Dashboard | /super-admin/dashboard | /dashboard/* | dashboard:view | SA-5 |
| Zonal Dashboard | /zone/dashboard | /dashboard/* (scoped) | dashboard:view | ZA-5 |
| Zones list + add/edit | /super-admin/zones | /zones | zones:* | SA-1.1 |
| Zonal Admins (accounts) | /super-admin/zonal-admins | /zonal-admins | admins:* | SA-1.2 |
| Zone Teams | /super-admin/access/teams | /zones/{id}/team | access:* | SA-1.8 |
| Access Profiles | /super-admin/access/profiles | /access-profiles | access:* | SA-1.4 |
| Member Access editor + Preview | /super-admin/access/members/[userId] | /zonal-admins/{id}/access, /preview | access:* | SA-1.9 |
| Access Change History | /super-admin/access/history | /access-changes | access:view | SA-1.10 |
| Restaurants list/add/detail | …/restaurants | /restaurants | restaurants:* | SA-2.2 / ZA-2.1 |
| Homemakers list/add/detail | …/homemakers | /homemakers | homemakers:* | SA-2.3 / ZA-2.1 |
| Menu / Food Items | …/menu-items | /menu-items | menu:* | SA-2.4 / ZA-2.3 |
| Customers list/detail | …/customers | /customers | customers:* | SA-3.1 / ZA-3.2 |
| Delivery Partners | …/delivery-partners | /delivery-partners | delivery:* | SA-3.2 / ZA-3.1 |
| Orders list/detail | …/orders | /orders | orders:* | SA-4.3-4.4 / ZA-4.1-4.2 |
| Payments (tx, refunds, payouts, reconciliation) | …/payments | /payments, /refunds, /payouts | payments:*, refunds:* | SA-6.7 / ZA-6.1-6.2 |
| COD settlement | …/payments/cash | /cash-settlements | settlements:* | SA-6.3 / ZA-6.3 |
| Notifications | /super-admin/notifications | /notifications | notifications:* | SA-7.3 |
| Settings (9 tabs) | /super-admin/settings/* | /settings/{group} | settings:* | SA-7.1-7.2 |
| System logs | /super-admin/settings/logs | /audit-logs | audit:view | SA-7.4 |
| Analytics, Offers, Reviews, Support | /super-admin/... | — | module:* | SA-8 (P2) |

## 6. v1.2 findings from the later Figma design file
- Login has role tabs and a Google login button: tabs kept, Google removed (D42, D46). Copy still says "Gocart" (D48).
- Settings > User Management exists as a tab (D43); Payments has Customer Payments / Restaurant Payouts / Delivery Partner Payouts / Refunds tabs (D44); Homemakers show food category, experience and availability (D45).
- **No frames exist for the Access Control panel** (Zone Teams, Access Profiles, Member Access editor, Preview, History), Order Details, Zonal Payments, COD settlement, notification compose. The Figma MCP call limit was reached, so remaining frames were not reviewed (D47). Build those from docs 20 and 22 and have the designer review at the sprint demo.
