# 20 — Admin Panel Screen Specification (Super Admin and shared screens, v1.1)

v1.1: reconciled with the Figma screenshots. Discrepancy list and gap list: doc 37.

Each screen: purpose, data, actions, states. Zonal Admin sees the same screens zone-scoped unless stated.

| Screen | Contents and actions |
|---|---|
| **Login** | Email, password (show/hide), remember me, forgot password; errors; 2FA step; role routing |
| **Super Admin Dashboard** | Greeting + date filter. KPI cards (two rows, per Figma): Total Orders, Total Customers, Total Restaurants, Active Restaurants, Pending Verification, Suspended; Total Revenue, Platform Commission, Restaurant Payouts, Total Refunds, Avg Order Value, Cancellation Rate. Charts: Order Overview (Today/Week, hover tooltip), Revenue Overview (order revenue / restaurant payouts / commission), Order Status donut, Top Food Categories, Zone Performance bar. Lists: Recent Orders, New Registrations (Customers/Restaurants/Delivery Partners tabs). Platform Health card: DB-derived only (D34). Card: zones without an admin. Click-through to lists |
| **Zonal Dashboard** | "Welcome back, <name>" with subtitle "<Zone> Zone Overview" or "<Zone>, <Zone> + N more". Cards: Total Orders, Total Restaurants, Total Homemakers, Total Delivery Partners, Total Customers (Figma) plus Today's Revenue (PDF; confirm). Widgets: Order Overview (Last 7 days), Order Status donut, Top Performing Restaurants, **Orders by zone (scope > 1) / by area (single zone)**, Recent Orders, Recent Restaurants / Delivery Partners / Customers. Scope-limited data only |
| **Orders list** | KPI cards (Total, Pending/Delivered, Preparing, Out for Delivery, Cancelled), tab filters, search (order no, customer, phone), filters (date, vendor, customer, delivery partner, payment method incl. Wallet, status, zone), Zone chip when scope > 1, table: Order ID, customer, vendor, amount, status, payment, partner, time; row actions; export CSV; auto refresh |
| **Order details** | Header with status badge and actions; items; amounts (subtotal, tax, delivery, discount, total, commission); customer and address; vendor; delivery partner (assign/reassign); payment and refunds panel; timeline from status history; internal notes; actions: accept, mark ready, assign, cancel, refund |
| **Restaurants list / Add / Edit / Details** | KPI cards (Total, Pending Verification, Active, Suspended); tabs Restaurants / Homemakers; table columns incl. Verification and Status separately; list filters: status, cuisine, area, zone; Details tabs: Overview, Documents, Menu, Orders, Commission and hours, Activity; actions: verify, activate, suspend, edit, delete (soft) |
| **Homemakers** | Same structure with homemaker fields |
| **Menu / Food Items** | Table by vendor, category, price, stock, availability toggle, featured toggle; bulk actions; add/edit overlay |
| **Customers** | List, profile (contact, addresses, orders, refunds, status), block/unblock |
| **Delivery Partners** | List, add, verification (documents), availability, assigned orders, performance, cash in hand, settlement |
| **Payments** | Tabs: Transactions, Refunds (incl. Pending approval queue for Super Admin), Payouts, Reconciliation. Refund dialog: type, amount, reason, note; limit warning |
| **Analytics** (P2) | Revenue, orders, vendor performance, trends; date range |
| **Offers and Coupons** (P2) | Codes, discount, validity, limits, zone scope |
| **Reviews and Ratings** (P2) | Moderation list |
| **Support** (P2) | Tickets |
| **Notifications** | Compose to audience (zone, vendors, partners, customers), channel, schedule, history |
| **Zone Management** | KPI cards (Total/Active/Inactive/Upcoming); table: zone (colour dot), city, state, Zonal Admin(s) avatar stack, status, restaurants, homemakers, delivery partners, customers; filters status/state; Add/Edit overlay: Zone Name, City, State, Pincode Range, Delivery Charge, Status (Active/Inactive/Upcoming), Description; deactivate with impact warning |
| **Zonal Admins** | List with zone chips + profile per zone; Add/Edit overlay: Full Name, Email, Phone, Password, Confirm Password, Status (account only); tab "Access" opens the Member Access editor; reset password; revoke sessions |
| **Zone Teams** *(new, D41, no Figma)* | Zone list → team of members (avatar, name, profile, overrides count, limits, last active). Actions: add member (picks profile), remove member, open member access. Banner for zones with no member |
| **Access Profiles** *(new)* | List of templates (name, members using it). Editor: module × View/Add/Edit/Delete/Status matrix, default per-refund and daily refund limits, flags reveal contacts / export. Non-grantable modules shown locked. Save → impact notice "affects N members" → re-auth |
| **Member Access editor** *(new)* | Member header; one card per zone: Profile dropdown, overrides (per module/action grant or deny chips), limits, flags; "Same access in all zones" toggle; add/remove zone; **Access Preview** drawer showing effective permissions and which sidebar items and dashboard tiles the member will see; Save → diff dialog → re-auth → email notice |
| **Access Change History** *(new)* | Table from `access_changes`: when, actor, member, zone, change, before/after diff |
| **Roles and Permissions** | Superseded by **Access Profiles** (matrix keeps View/Add/Edit/Delete plus the new **Status** column, D29). Figma frame does not exist (D47) |
| **Settings** | General; Business and Operations; Payment and Commission (commission default, gateway, payouts, refund limit, tax/GST); Order Settings (preparation time, auto-cancel, cancellation rules, scheduled orders, delivery fee/radius); User Management; Security (2FA, policy, timeouts, lockout, sessions, login history); Notifications; Integrations; System Logs / Audit viewer |

## Screen requirements for every list
Search, filters in dropdown overlays, sort, pagination (25 default), column visibility, empty state, loading skeleton, error with retry, permission-aware actions.

## Prototype flow reference (Figma)
Login → Dashboard → Zone Management → Add/Edit Zone; Dashboard → Zonal Admins → Add/Edit; Dashboard → Roles & Permissions → Save; Orders → Order Details → status/action flow; Restaurants → Details → Menu; Settings → section → Save Changes.

## Integration screens (v2.0, no Figma frames yet, D47)
Settings > Integrations (Integration Hub) and the Pending registrations inbox: full spec in `G-integration/45`. Order timeline rows show a source chip (Customer app, Vendor app, Partner app, Admin name, System). Detail pages of customers, vendors and partners show "Registered via app on <date>".
