# 21 — Zonal Admin and Vendor Screen Specification (Shop Panel equivalent, v1.1)

The generic template includes a Shop Panel for shop owners. GloAro has no separate vendor-owner panel in this project: **restaurants and homemakers are managed by admins** in this panel, and vendors use their own apps (out of scope). This document therefore specifies the Zonal Admin experience and vendor management screens.

**[ASSUMPTION]** If a vendor-facing web panel is added later, it reuses the modules in doc 07 with a `vendor` role scoped by vendor_id instead of zone_id.

## 1. Zonal Admin workspace
- Sidebar: Dashboard, Orders, Restaurants, Homemakers, Delivery Partners, Customers, Payments (D36).
- **Zone scope switcher** in the sidebar zone card (doc 18 §4, doc 36): All my zones / single zone. Zone chip shown on rows when scope > 1.
- All screens from doc 20 with: zone filter limited to assigned zones, no commission editing, refunds limited (limit banner shows remaining daily amount across zones), no Settings.

## 2. Vendor management screens (both modules, built as separate tabs/pages)
### Vendor list
Columns: name, owner, phone, area, status, rating, commission, today's orders. Filters: status, cuisine/speciality, date added. Bulk: activate, deactivate, suspend.
### Vendor profile (tabs)
1. Profile: name, owner, contact, address, map pin, cuisine/speciality, logo/photos.
2. Documents: upload, preview, verify/reject with note.
3. Menu: items table with availability toggle, price, stock.
4. Variants and add-ons (P1): sizes, extras, price delta.
5. Inventory and availability: stock, schedule, temporary close.
6. Hours: weekly schedule and holidays.
7. Orders: vendor's orders.
8. Promotions (P2).
9. Finance: commission, payouts, refunds attributed.
10. Activity: audit entries.
### Incoming orders view (monitoring)
Live list of PLACED/ACCEPTED/PREPARING orders for a vendor with timers and acceptance timeout; admin can accept on vendor's behalf or cancel.

## 3. Restaurant vs Homemaker differences
| Aspect | Restaurant | Homemaker |
|---|---|---|
| Identity | Business name, GST/FSSAI | Person name, home kitchen, FSSAI (as applicable) |
| Menu | Full catalogue | Smaller, daily/limited items, optional pre-order |
| Capacity | Hours-based | Daily capacity limit field |
| Verification | Business documents | Identity + kitchen verification |
Fields beyond this table to be confirmed against the Figma homemaker screens.

## 4. Analytics
Zonal Admin analytics are not in current scope. Vendor-level counts appear on vendor profile only.
