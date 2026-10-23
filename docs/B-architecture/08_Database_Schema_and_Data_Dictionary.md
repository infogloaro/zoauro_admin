# 08 — Database Schema and Data Dictionary (v1.2)

Conventions: UUID v7 primary keys; `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`; money in integer paise; timestamps UTC; Prisma enums for statuses.
**v1.1/v1.2 changes are marked ★ (v1.2 = ★★: Access Control)** (multi-zone admin, Figma fields, tables that other docs referenced but v1.0 never defined).

## Identity and access
| Table | Columns |
|---|---|
| users | id, name, email (unique where deleted_at null), phone, password_hash, role_id, status, mfa_enabled, mfa_secret_encrypted, backup_codes_hash, must_change_password, failed_attempts, locked_until, last_login_at |
| roles | id, name (SUPER_ADMIN, ZONAL_ADMIN), is_system. **Identity role only; no permissions here (v1.2)** |
| **access_profiles ★★** | id, name (unique), description, is_seed, default_per_refund_limit, default_daily_refund_limit, default_can_reveal, default_can_export, created_by, updated_by — reusable templates (D41) |
| **profile_permissions ★★** | profile_id, module, can_view, can_add, can_edit, can_delete, can_status; PK (profile_id, module). Replaces v1.1 `role_permissions` |
| **admin_zone_assignments ★★** | id, user_id, zone_id, **profile_id (FK access_profiles), per_refund_limit nullable, daily_refund_limit nullable, can_reveal nullable, can_export nullable (null = profile default)**, assigned_by, assigned_at, revoked_at nullable, revoked_by, note; partial unique (user_id, zone_id) WHERE revoked_at IS NULL. A zone's team = active rows for that zone. No "one active zone" rule (D3 changed). Index (zone_id) WHERE revoked_at IS NULL |
| **assignment_overrides ★★** | assignment_id, module, action (VIEW/ADD/EDIT/DELETE/STATUS), effect (GRANT/DENY), PK (assignment_id, module, action). Deny wins |
| **access_changes ★★** | id, actor_id (Super Admin), member_id, zone_id nullable, change_type (PROFILE_SET, OVERRIDE_SET, LIMIT_SET, ZONE_ADDED, ZONE_REMOVED, PROFILE_EDITED), before_json, after_json, created_at — append-only; also written to `audit_logs`; powers the Access change history screen |
| sessions | id, user_id, token_hash, ip, user_agent, expires_at, revoked_at, last_seen_at |
| login_history | id, user_id, email_attempted, success, ip, user_agent, reason, created_at |
| password_reset_tokens | id, user_id, token_hash, expires_at, used_at |
| audit_logs | id, actor_id, **zone_id (zone of the entity; null for global)**, module, action, entity_type, entity_id, before_json, after_json, ip, request_id, created_at (append-only) |
| **user_preferences ★** | user_id, last_zone_scope (nullable = all zones), table_density, updated_at |

Super Admin has no assignment rows (global). A Zonal Admin with zero active assignments can log in but sees an empty-scope screen ("No zones assigned").

## Geography
| Table | Columns |
|---|---|
| zones | id, name (unique), code (unique), city, **state ★**, pincode_from, pincode_to, delivery_charge, status (**ACTIVE, INACTIVE, UPCOMING ★**), description, color_hex (chart dot) |
| serviceable_pincodes | id, zone_id, pincode |

Zone list counts (restaurants, homemakers, partners, customers, admins) are derived queries/materialised counters, not columns.

## Vendors and menu
| Table | Columns |
|---|---|
| restaurants | id, zone_id, name, owner_name, phone, email, address, **area ★**, lat, lng, cuisine_tags, commission_pct, status, **verification_status ★ (PENDING, VERIFIED, REJECTED), verification_note ★**, verified_at, verified_by, opening_hours_json, logo_key, min_order, gst_no, fssai_no, **review_due_at ★★ (A1 manual review deadline; null = 48 h SLA from created_at, doc 45)** |
| homemakers | id, zone_id, name, phone, email, address, **area ★**, lat, lng, speciality_tags, **food_category ★★, experience_years ★★, is_available ★★ (D45)**, **daily_capacity ★ (int ≥ 1; doc 22 had it, v1.0 schema lacked it)**, commission_pct, status, **verification_status ★, verification_note ★**, verified_at, verified_by, opening_hours_json, photo_key, min_order, fssai_no, **review_due_at ★★ (A1; same as restaurants)** |
| vendor_documents | id, vendor_type, vendor_id, doc_type, file_key, verified, verified_by, rejection_note, **expires_on ★★ (A1 date-only expiry; null = no expiry)** |
| **onboarding_requirements ★★ (A1)** | id, vendor_type (RESTAURANT, HOMEMAKER), doc_type, label, weight (int 0–100), active, sort_order, created_at, updated_at; unique (vendor_type, doc_type). Advisory checklist feeding the readiness score — never an activation gate (owner decision 2026-10-22). Seeded defaults: restaurants FSSAI 30 / GST 20 / PAN 15 / BANK 20 / ID 15; homemakers ID 35 / FSSAI 25 / BANK 25 / PAN 15 |
| categories | id, zone_id nullable (global), name, sort_order |
| menu_items | id, zone_id, **vendor_type ★ (RESTAURANT, HOMEMAKER, HOTEL) + vendor_id — exactly one owning provider (replaces the v1.0 restaurant_id/homemaker_id columns and their CHECK ★)**, name, description nullable, category nullable, price (integer paise), **dietary ★ (VEGETARIAN, NON_VEG, EGG)**, **approval_status ★ (PENDING, APPROVED, REJECTED, ARCHIVED), rejection_reason, approved_at, approved_by**, deleted_at; indexes (zone_id, approval_status), (vendor_type, vendor_id) |

## Hotels, bookings and dining ★ (owner-authorized build, doc 32 TD-33)
| Table | Columns |
|---|---|
| **hotels ★** | id, zone_id, name, owner_name, phone, email, address, area, total_rooms, commission_pct, gst_no, status (VendorStatus: PENDING, ACTIVE, INACTIVE, SUSPENDED), verification_status/note, verified_at, verified_by, deleted_at; zone-owned like restaurants (doc 10 §4 lifecycle reused) |
| **room_bookings ★** | id, zone_id, hotel_id, customer_name, customer_phone (masked in lists, D26), room_type, check_in/check_out (UTC date boundaries from `YYYY-MM-DD`), guests, status (PENDING, CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED), payment_status, amount (integer paise), note; index (hotel_id, check_in) for the overlap check |
| **dining_reservations ★** | id, zone_id, hotel_id nullable, restaurant_id nullable (service requires at least one; venue zone must equal the item zone), customer_name, customer_phone (masked in lists), reserved_date (UTC), reserved_time (`HH:MM`), guests, table_area, status (PENDING, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW), payment_status, amount nullable paise, note |

## People
| customers | id, name, phone (unique), email, status (ACTIVE, INACTIVE, **BLOCKED ★**), wallet_balance, **source ★ (APP, ADMIN, REFERRAL, OTHER — Figma "registration source")**, user_type (CUSTOMER) |
|---|---|
| customer_addresses | id, customer_id, label, address, **area ★**, lat, lng, pincode, zone_id, is_default |
| delivery_partners | id, zone_id, name, phone, vehicle_type, vehicle_no, **area ★**, status, is_online, verified_at, current_orders, cash_in_hand, **rating_avg ★, deliveries_count ★ (counters)** |
| **cash_settlements ★** | id, delivery_partner_id, zone_id, expected_amount, handed_in_amount, variance, settled_by, settled_at, note (doc 16 daily COD settlement had no table in v1.0) |

## Orders and money
| Table | Columns |
|---|---|
| orders | id, order_no (unique), zone_id, customer_id, restaurant_id nullable, homemaker_id nullable (CHECK exactly one), delivery_partner_id, status, subtotal, tax, delivery_charge, discount, total, commission_pct, commission_amount, **payment_method (ONLINE, COD, WALLET ★), payment_sub_method ★ (UPI, CARD, null)**, payment_status, address_snapshot_json, placed_at, accepted_at, ready_at, delivered_at, cancelled_at, cancel_reason, cancelled_by, version |
| order_items | id, order_id, menu_item_id, name_snapshot, price_snapshot, qty |
| order_status_history | id, order_id, from_status, to_status, actor_id, actor_type, note, created_at |
| payments | id, order_id, provider, provider_payment_id (unique), amount, status, method, idempotency_key (unique), raw_json |
| refunds | id, order_id, payment_id, amount, type, reason_code, reason_note, status (PENDING_APPROVAL, APPROVED, PROCESSED, FAILED, REJECTED), requested_by, requested_at, approved_by, decided_at, decision_note, provider_refund_id, idempotency_key (unique), target (GATEWAY, WALLET, MANUAL) |
| payouts | id, **payee_type (RESTAURANT, HOMEMAKER, DELIVERY_PARTNER ★★, D44)**, payee_id, zone_id, period_from, period_to, gross, commission, net, status, paid_at, paid_by |
| ledger_entries | id, order_id, account, debit, credit, ref_type, ref_id, created_at (append-only) |
| webhook_events | id, provider, event_id (unique), payload, received_at, processed_at |
| **reconciliation_runs ★** | id, run_date, provider, matched, missing, amount_mismatch, status_mismatch, report_key, created_at |
| **refund_daily_usage ★★** | assignment_id, usage_date, amount_total (**per member per zone**, D20 changed); PK (assignment_id, usage_date) |

## Platform
| Table | Columns |
|---|---|
| settings | key (unique), value_json, group, updated_by |
| coupons | id, code, zone_id nullable, type, value, min_order, valid_from, valid_to, usage_limit, used_count, status |
| notifications | id, audience, zone_id, title, body, channel, status, scheduled_at |
| reviews | id, order_id, customer_id, target_type (RESTAURANT, DELIVERY, FOOD_ITEM), target_id, rating, comment, status (PUBLISHED, FLAGGED, HIDDEN) |
| **outbox ★** | id, event_type, payload_json, zone_id, created_at, published_at, attempts (doc 10 required it; v1.0 never defined it) |
| **idempotency_keys ★** | key, route, user_id, request_hash, response_json, status_code, created_at; purge after 24 h |
| **exports ★** | id, requested_by, module, filters_json, status, file_key, expires_at (24 h, doc 15) |
| **data_subject_requests ★** | id, customer_id, type, status, requested_at, completed_at, handled_by |
| **api_clients ★** | id, name, type (CUSTOMER_APP, VENDOR_APP, PARTNER_APP), environment (SANDBOX, PRODUCTION), key_id (unique), scopes, ip_allowlist, rate_limit_per_min, status (ACTIVE, DISABLED), webhook_url, last_used_at — credentials for the Integration API (docs 42, 45) |
| **api_client_secrets ★★** | id, client_id, secret_encrypted (AES-256-GCM), created_at, expires_at (24 h overlap on rotation), revoked_at |
| **external_refs ★★** | entity_type, internal_id, client_id, external_id; unique (client_id, entity_type, external_id) |
| **integration_inbound_log ★★** | id, client_id, request_id, idempotency_key, method, path, entity_type, entity_id, zone_id, result (APPLIED, REJECTED, DUPLICATE, FAILED), error_code, latency_ms, body_redacted_json, received_at; retention 90 days; index (client_id, received_at), (entity_id) |
| **webhook_subscriptions ★★** | id, client_id, url, secret_encrypted, event_types[], status (ACTIVE, PAUSED) |
| **webhook_deliveries ★★** | id, outbox_id, subscription_id, event_id, attempt, status (PENDING, DELIVERED, FAILED, DEAD), http_status, response_ms, next_attempt_at, delivered_at |
| **integration_alerts ★★** | id, client_id, type (DEAD_LETTER, SILENT_CLIENT, SIGNATURE_SPIKE, RECONCILIATION), detail_json, acknowledged_by, acknowledged_at |
| **Column additions (v2.0) ★★** | `zone_id` nullable on restaurants, homemakers, delivery_partners with `zone_assignment_status` (ASSIGNED, UNASSIGNED) and CHECK (zone_id IS NOT NULL OR zone_assignment_status='UNASSIGNED'); `source` (APP, ADMIN, IMPORT) and `source_updated_at` on customers/restaurants/homemakers/delivery_partners; `is_open` on restaurants/homemakers; `admin_disabled` on menu_items; `force_offline_until` on delivery_partners; `kind` (RESTAURANT, SHOP) on restaurants; `source_app` on order_status_history; `sequence` bigserial on outbox (feed cursor); `payment_expires_at` on orders |

## Enums
OrderStatus: PLACED, ACCEPTED, PREPARING, READY, ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, REFUNDED. VendorStatus: PENDING, ACTIVE, INACTIVE, SUSPENDED. VerificationStatus: PENDING, VERIFIED, REJECTED. PaymentStatus: PENDING, PAID, FAILED, REFUNDED, PARTIALLY_REFUNDED. ZoneStatus: ACTIVE, INACTIVE, UPCOMING. CustomerStatus: ACTIVE, INACTIVE, BLOCKED. PaymentMethod: ONLINE, COD, WALLET.

## Indexes and constraints
- Zone-owned tables: `(zone_id, status)` and `(zone_id, created_at DESC)`. Multi-zone lists use `zone_id = ANY($1)` and the same indexes.
- orders: `(zone_id, status, placed_at DESC)`, `(customer_id)`, `(restaurant_id)`, `(homemaker_id)`, `(delivery_partner_id, status)`.
- Partial unique indexes where `deleted_at IS NULL` for emails, codes.
- `pg_trgm` GIN on names, phone, order_no for search.
- FKs RESTRICT; history preserved via soft delete.
- Optimistic locking with `orders.version`.

## Scope (zone) isolation
`zone_id` NOT NULL on all zone-owned tables. Customer visibility is derived (address or order in scope, D25), not a column. Optional RLS: `zone_id = ANY(current_setting('app.zone_ids')::uuid[])` set with `SET LOCAL` per request transaction.

## Migrations and seeding
Prisma Migrate; expand-then-contract; seed identity roles, the five example Access Profiles (doc 04 §2), first Super Admin (password from secret store, forced change), demo zones **A, B, C; members: Admin(A full), Admin(A+B: full in A, read-only in B), Admin(A, payments denied), a second member in zone A** (staging/dev only) so multi-zone tests have fixtures.
