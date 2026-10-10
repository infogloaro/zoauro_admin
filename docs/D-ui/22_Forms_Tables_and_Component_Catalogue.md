# 22 — Forms, Tables and Component Catalogue

## 1. Forms and validation (Zod, shared client and server)
| Form | Fields and rules |
|---|---|
| Login | email (valid), password (required) |
| Zone | name (2–60, unique), city (required), state (required), pincodeFrom/To (6-digit, from ≤ to, optional), deliveryCharge (≥ 0, paise), status (ACTIVE/INACTIVE/UPCOMING), description (≤ 500) |
| Zonal Admin (account) | fullName (2–80), email (valid, unique), phone (E.164 or 10-digit India), password (policy), confirmPassword (match), status |
| Restaurant | **zoneId (required, assigned zones only)**, name, ownerName, phone, email, address, area, lat/lng, cuisineTags (1–5), commissionPct (0–50, Super Admin only to edit), openingHours, logo (≤ 5 MB), status |
| Homemaker | **zoneId (required, assigned zones only)**, name, phone, email, address, area, lat/lng, specialityTags, dailyCapacity (≥ 1), commissionPct, photo, status |
| Menu item | name (2–80), description (≤ 500), vendor (one), category, price (> 0, paise), stock (≥ 0, int), isAvailable, isFeatured, image |
| Delivery partner | **zoneId (required, assigned zones only)**, name, phone (unique), vehicleType, vehicleNo (format), area, documents, status |
| Customer (admin-created, D28) | name, phone (unique), email, first address (zoneId from assigned zones, area), status; `source=ADMIN` |
| Refund | type (full/partial/goodwill), amount (1 ≤ amount ≤ refundable), reasonCode (enum), note (required if OTHER) |
| Cancel order | reasonCode, note |
| Access Profile | name (2–60, unique), description (≤ 200), matrix module × (view, add, edit, delete, status) booleans (only grantable modules editable), defaultPerRefundLimit and defaultDailyRefundLimit (paise ≥ 0, optional), defaultCanReveal, defaultCanExport |
| Member Access (one block per zone) | zoneId (active, unique per member), profileId (required), overrides[] {module, action, effect GRANT/DENY} (grantable modules only), perRefundLimit, dailyRefundLimit (optional, paise ≥ 0, ≤ 1,00,000,00 paise cap setting), canReveal, canExport; at least 0 zones; save requires re-auth |
| Settings | per group schema; numeric ranges; save with confirmation for risky fields |

Rules: validate on blur and submit; show server errors mapped to fields; trim strings; disable submit while pending; protect against double submit.

## 2. Table standard (`DataTable`)
Server-side pagination, sorting, filtering; column definitions with types; sticky header; row selection for bulk actions; row action menu; density toggle; column visibility; CSV export (permission-gated); URL-synced state (`?page&pageSize&sort&q&filters`).

### Filters per list
Orders: date range, status, vendor, customer, partner, payment method/status, zone (Super Admin: any; Zonal Admin: assigned only). Vendors: status, verification, tags, area, zone. Customers: status, location/area, user type, registration source, date joined. Partners: status, online, vehicle type, area, zone. Payments: status, method, date. Audit: actor, module, action, date.

### Bulk actions
Vendors: change status. Menu: availability, category, price adjust. Orders: none (safety). Confirmation dialog with count and preview; result summary with partial failures.

## 3. Dialogs
Add/Edit overlay (Sheet/Dialog), Confirm destructive, Refund, Assign partner, Reason prompt, Reauthentication prompt, Export started.

## 4. States
| State | Behaviour |
|---|---|
| Loading | Skeleton rows/cards matching layout |
| Empty | Illustration, one-line explanation, primary action if permitted |
| Error | Message, requestId (small), Retry button |
| No results | "No matches", clear filters button |
| Forbidden | "You don't have access", link home |
| Stale (409) | "This record changed. Reload." |

## 5. Shared components
PageHeader, StatCard, StatusBadge, **ZoneScopeSwitcher, PermissionMatrix (profile and per-zone variants), ProfilePicker, OverrideChips, AccessPreviewDrawer, DiffDialog**, DataTable, FilterBar, SearchInput, ConfirmDialog, FormField, MoneyInput (paise-safe), PhoneInput, ImageUploader (pre-signed), DocumentViewer, Timeline, PermissionMatrix, ZoneChip, EmptyState, ErrorState, Toast.
