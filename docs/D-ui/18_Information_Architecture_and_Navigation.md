# 18 — Information Architecture and Navigation (v1.1)

## 1. Route groups
| Group | Base path | Who |
|---|---|---|
| Auth | `/login`, `/forgot-password`, `/reset-password`, `/2fa` | public/pre-session |
| Super Admin | `/super-admin/...` | Super Admin only |
| Zonal Admin | `/zone/...` | Zonal Admin. Super Admin may use the same screens inside `/super-admin` with a zone filter |

Role routing: Super Admin → `/super-admin/dashboard`; Zonal Admin → `/zone/dashboard`; Zonal Admin with no zones → `/zone/no-zones`. A Zonal Admin visiting `/super-admin/*` gets 404; unauthenticated users go to `/login?next=`. A Super Admin visiting `/zone/*` gets the 403 page (owner decision, P14): the same screens are reached inside `/super-admin` with a zone filter. The check runs in each area's layout on the server, before anything streams, so a signed-out visitor gets a real 307.
The Figma login card has two tabs, **Super Admin** ("Full access to all zones") and **Zonal Admin** ("Access to assigned zone"). v1.2 keeps them (D46): the tab is a UI selector, the server validates it against the account's identity role. "Login with Google" is not in v1 (D42).

## 2. Super Admin sidebar (per Figma screenshots)
Dashboard · Restaurants (tabs: Restaurants / Homemakers, D27) · Menu / Food Items · Orders · Customers · Delivery Partners · Payments · Analytics · Offers & Coupons · Reviews & Ratings · Support · Notifications · Settings · **Zone Administration** (group, Figma shows one entry; v1.2 expands it): **Zone Management · Zonal Admins · Zone Teams · Access Profiles · Access Change History** (the last four are the Access Control panel, D41; designs missing, D47).
"Need Help? Contact Support" card at the bottom of the sidebar is a static link (config) in v1.

## 3. Zonal Admin sidebar (Figma scope)
Dashboard · Orders · Restaurants · Homemakers · Delivery Partners · Customers · **Payments (D36: not in Figma; needs design, or refunds live in Order Details only)**.
Not included: Zone Reports, Zone Performance, Complaints, Settings, Offers, Analytics.

## 4. Zone scope switcher (new, multi-zone)
The Figma zonal sidebar already has a zone card with a chevron ("Coimbatore Zone · Zonal Admin"). In v1.1 this card is the **zone scope switcher**:
- Options: "All my zones (N)" and each assigned zone. Default "All my zones" (D19). One assigned zone → card is static, no chevron.
- Selection is reflected in the URL `?zone=<code>[,<code>]` and saved to `user_preferences`. All lists, KPIs, charts, exports and search respect it.
- Create/edit forms of zone-owned records show a required Zone field limited to assigned zones (R-ACC-6).
- Every list row and detail header shows a **ZoneChip** when scope > 1 zone.
Full behaviour in doc 36.

## 5. Route map
| Route | Screen |
|---|---|
| /super-admin/dashboard | Global dashboard |
| /super-admin/orders, /orders/[id] | Orders list, detail |
| /super-admin/restaurants, /new, /[id], /[id]/menu | |
| /super-admin/homemakers, /new, /[id], /[id]/menu | |
| /super-admin/menu-items | |
| /super-admin/customers, /[id] | |
| /super-admin/delivery-partners, /new, /[id] | |
| /super-admin/payments, /refunds, /payouts, /reconciliation | |
| /super-admin/analytics, /offers, /reviews, /support, /notifications | |
| /super-admin/zones, /zones/new, /zones/[id] | |
| /super-admin/zonal-admins, /new, /[id] | Member accounts; the Access tab links to the Member Access editor |
| /super-admin/access/teams, /teams/[zoneId] | Zone Teams: zone → members, add/remove member, open member access |
| /super-admin/access/profiles, /[id] | Access Profiles (templates, matrix, limits) |
| /super-admin/access/members/[userId] | Member Access editor (zone × profile × overrides × limits) + Access Preview |
| /super-admin/access/history | Access Change History |
| /super-admin/registrations, /zone/registrations | Pending registrations inbox (Needs a zone tab: Super Admin only) |
| /super-admin/settings/integrations | Integration Hub (clients, webhooks, event monitor, needs attention) |
| /super-admin/settings/{general,business,payment,orders,users,security,notifications,integrations,logs} | |
| /zone/dashboard, /orders, /orders/[id], /restaurants…, /homemakers…, /delivery-partners…, /customers…, /payments… | Same screens, scoped to the switcher |
| /zone/no-zones | Empty-scope message |

## 6. Layouts
- `AuthLayout`: centered card.
- `AdminShell`: collapsible dark navy/blue gradient sidebar, top bar (global search, notification bell with badge, profile menu; theme toggle is P2, D33), breadcrumb, content area.
- Zonal shell: zone scope switcher card at top of sidebar (zonal sidebar uses orange active item per Figma; Super Admin uses blue active item).
- One reusable sidebar component, role-driven menu config.

## 7. Access restrictions
Menu items built from `permissions`; route guards in layout server components; server enforces regardless of UI. Unknown route → 404 page; forbidden action in UI shows disabled control with tooltip.

## 8. Navigation rules
Active state consistent; breadcrumbs on detail pages; filters persisted in URL query; back navigation keeps filters and zone scope; confirmation before leaving dirty forms.
