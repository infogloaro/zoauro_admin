# 08 — Database Schema and Data Dictionary (v1.2)

Conventions: UUID v7 primary keys; `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`; money in integer paise; timestamps UTC; Prisma enums for statuses.
**v1.1/v1.2 changes are marked ★ (v1.2 = ★★: Access Control)** (multi-zone admin, Figma fields, tables that other docs referenced but v1.0 never defined).

## Identity and access
| Table | Columns |
|---|---|
| users | id, name, email (unique where deleted_at null), phone, password_hash, role_id, status, mfa_enabled, phone_verified_at, password_changed_at (MFA secrets and codes moved to the tables below, doc 52 §3), must_change_password, failed_attempts, locked_until, last_login_at |
| roles | id, name (SUPER_ADMIN, ZONAL_ADMIN), is_system. **Identity role only; no permissions here (v1.2)** |
| **access_profiles ★★** | id, name (unique), description, is_seed, default_per_refund_limit, default_daily_refund_limit, default_can_reveal, default_can_export, created_by, updated_by — reusable templates (D41) |
| **profile_permissions ★★** | profile_id, module, can_view, can_add, can_edit, can_delete, can_status; PK (profile_id, module). Replaces v1.1 `role_permissions` |
| **admin_zone_assignments ★★** | id, user_id, zone_id, **profile_id (FK access_profiles), per_refund_limit nullable, daily_refund_limit nullable, can_reveal nullable, can_export nullable (null = profile default)**, assigned_by, assigned_at, revoked_at nullable, revoked_by, note; partial unique (user_id, zone_id) WHERE revoked_at IS NULL. A zone's team = active rows for that zone. No "one active zone" rule (D3 changed). Index (zone_id) WHERE revoked_at IS NULL |
| **assignment_overrides ★★** | assignment_id, module, action (VIEW/ADD/EDIT/DELETE/STATUS), effect (GRANT/DENY), PK (assignment_id, module, action). Deny wins |
| **access_changes ★★** | id, actor_id (Super Admin), member_id, zone_id nullable, change_type (PROFILE_SET, OVERRIDE_SET, LIMIT_SET, ZONE_ADDED, ZONE_REMOVED, PROFILE_EDITED), before_json, after_json, created_at — append-only; also written to `audit_logs`; powers the Access change history screen |
| sessions | id, user_id, token_hash, ip, user_agent, expires_at, revoked_at, last_seen_at, mfa_verified_at, mfa_method, remember, reauth_at, reauth_level, restricted |
| login_history | id, user_id, email_attempted, success, ip, user_agent, reason (BAD_PASSWORD, WRONG_TAB, LOCKED, INACTIVE, MFA_FAILED, MFA_EXPIRED, MFA_LOCKOUT, OK), mfa_method, created_at (purged after 12 months) |
| password_reset_tokens | id, user_id, token_hash, expires_at, used_at |
| user_mfa_methods | id, user_id, type (AUTHENTICATOR, EMAIL_OTP, SMS_OTP), secret_encrypted (authenticator only, AES-256-GCM), verified_at, last_used_step, is_primary, disabled_at, created_at, updated_at; unique (user_id, type) where disabled_at is null (doc 52 §3) |
| mfa_challenges | id, user_id, purpose (LOGIN, ENROL_PROOF, ENROL_EMAIL, ENROL_SMS, REAUTH), method, code_hash, destination_hint, expires_at, attempts, max_attempts, send_count, last_sent_at, consumed_at, ip, created_at |
| mfa_backup_codes | id, user_id, code_hash, batch_id, used_at, created_at |
| audit_logs | **Redefined in doc 50 §3.1:** id (uuid v7), created_at, actor_type (USER, APP_CLIENT, SYSTEM, WEBHOOK), actor_id, actor_name, actor_role, zone_id (null for global), module, action, entity_type, entity_id, entity_label, outcome (SUCCESS, DENIED), sensitivity (NORMAL, HIGH), before_json, after_json (changed fields only, redacted), note, ip, user_agent, request_id. No foreign keys. Indexes: (zone_id, id desc), (zone_id, module, id desc), (entity_type, entity_id, id desc), (actor_id, id desc), (module, action, id desc), (sensitivity, id desc) plus expression indexes on lower(entity_label) and lower(actor_name) (doc 50 §3.1). Append-only: INSERT/SELECT only for the app role plus trigger; deletes only by the `zoauro_purge` role (doc 50 §3.2). Purge only after 3 years with verified archive |
| **user_preferences ★** | user_id, last_zone_scope (nullable = all zones), table_density, updated_at |

Super Admin has no assignment rows (global). A Zonal Admin with zero active assignments can log in but sees an empty-scope screen ("No zones assigned").

## Geography
| Table | Columns |
|---|---|
| zones | id, name (unique), code (unique), city, **state ★**, pincode_from, pincode_to, delivery_charge, status (**ACTIVE, INACTIVE, UPCOMING ★**), description, color_hex (chart dot, 12-token palette), version, activated_at, deactivated_at, deactivation_reason, created_by, deleted_at; code immutable and unique incl. soft-deleted; pincode_from/to are the entered range for display only (doc 53 §3) |
| serviceable_pincodes | id, zone_id, pincode char(6) **unique across all zones** (D82), source (RANGE, MANUAL, IMPORT), created_at; index zone_id (doc 53 §3) |

Zone list counts (restaurants, homemakers, partners, customers, admins) are derived queries/materialised counters, not columns.

## Vendors and menu
| Table | Columns |
|---|---|
| restaurants | id, zone_id, name, owner_name, phone, email, address, **area ★**, lat, lng, cuisine_tags, commission_pct, status, **verification_status ★ (PENDING, VERIFIED, REJECTED), verification_note ★**, verified_at, verified_by, opening_hours_json, logo_key, min_order, gst_no, fssai_no |
| homemakers | id, zone_id, name, phone, email, address, **area ★**, lat, lng, speciality_tags, **food_category ★★, experience_years ★★, is_available ★★ (D45)**, **daily_capacity ★ (int ≥ 1; doc 22 had it, v1.0 schema lacked it)**, commission_pct, status, **verification_status ★, verification_note ★**, verified_at, verified_by, opening_hours_json, photo_key, min_order, fssai_no |
| vendor_documents | id, vendor_type, vendor_id, doc_type, file_key, verified, verified_by, rejection_note |
| categories | id, zone_id nullable (global), name, sort_order |
| menu_items | id, zone_id, restaurant_id nullable, homemaker_id nullable, category_id, name, description, price, stock, is_available, is_featured, image_key, **dietary ★★ (VEGETARIAN, NON_VEG, EGG; D119), admin_override_at ★★ (doc 44, D127)**; CHECK exactly one of restaurant_id / homemaker_id. UI "Out of stock" = stock = 0 |
| **menu_item_change_requests ★★ (R09, D119)** | id, zone_id, menu_item_id nullable (null until a CREATE is approved), restaurant_id / homemaker_id (CHECK one), external_item_id, kind (CREATE, UPDATE, DELETE), status (PENDING, APPROVED, REJECTED, SUPERSEDED), proposed_json, base_json, source, submitted_by_client_id, decided_by, decided_at, decision_reason, version; partial unique: one PENDING per menu_item_id, one PENDING CREATE per (submitted_by_client_id, external_item_id) |

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
