export const ROLES = ['SUPER_ADMIN', 'ZONAL_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Zone lifecycle status — doc 08 ZoneStatus, doc 22 status field (D35 adds UPCOMING). */
export const ZONE_STATUSES = ['ACTIVE', 'INACTIVE', 'UPCOMING'] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];

export const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Vendor lifecycle (doc 08 VendorStatus) — restaurants and homemakers (M06/M07). */
export const VENDOR_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** Statuses the admin status endpoint may transition to (doc 10 §4). */
export const VENDOR_STATUS_TARGETS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type VendorStatusTarget = (typeof VENDOR_STATUS_TARGETS)[number];

/** Doc 08 VerificationStatus — separate from status (doc 10 §4, D22). */
export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_DECISIONS = ['VERIFIED', 'REJECTED'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/**
 * Hotel room-booking lifecycle (task: Hotel Room Booking Management;
 * doc 10 §4 transition style). PENDING → CONFIRMED | CANCELLED;
 * CONFIRMED → CHECKED_IN | CANCELLED; CHECKED_IN → CHECKED_OUT.
 * Cancel of a PAID booking marks the payment REFUNDED.
 */
export const BOOKING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Targets the status endpoint may transition to. */
export const BOOKING_STATUS_TARGETS = [
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
] as const;
export type BookingStatusTarget = (typeof BOOKING_STATUS_TARGETS)[number];

/** Payment settlement on a booking or dining reservation (doc 16 ledger lands later). */
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'REFUNDED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Dining reservation lifecycle (task: Hotel Dining tab). */
export const DINING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type DiningStatus = (typeof DINING_STATUSES)[number];

/** Approval workflow for menu/food items (task: Menu & Food Items). */
export const MENU_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
export type MenuApprovalStatus = (typeof MENU_APPROVAL_STATUSES)[number];

/** Bulk review targets (POST /menu-items/bulk). */
export const MENU_BULK_ACTIONS = ['APPROVE', 'ARCHIVE'] as const;
export type MenuBulkAction = (typeof MENU_BULK_ACTIONS)[number];

/**
 * Value bulk actions (doc 09 upstream row: `{action: availability |
 * category | price, ids ≤ 500}` — lowercase on the wire, all-or-nothing per
 * D124, preview at `/bulk/preview`). They run under `menu:edit`; the
 * approval actions above stay under `menu:status`.
 */
export const MENU_BULK_VALUE_ACTIONS = ['availability', 'category', 'price'] as const;
export type MenuBulkValueAction = (typeof MENU_BULK_VALUE_ACTIONS)[number];

export const MENU_BULK_ALL_ACTIONS = [...MENU_BULK_ACTIONS, ...MENU_BULK_VALUE_ACTIONS] as const;
export type MenuBulkAllAction = (typeof MENU_BULK_ALL_ACTIONS)[number];

/** Doc 09 list filter `availability` (D126 live rule: live = available && in stock && not admin-disabled). */
export const MENU_AVAILABILITY_FILTERS = [
  'live',
  'out_of_stock',
  'vendor_off',
  'admin_disabled',
] as const;
export type MenuAvailabilityFilter = (typeof MENU_AVAILABILITY_FILTERS)[number];

/** R09 vendor menu change requests (doc 09, D119). */
export const MENU_CHANGE_KINDS = ['CREATE', 'UPDATE', 'DELETE'] as const;
export type MenuChangeKind = (typeof MENU_CHANGE_KINDS)[number];

export const MENU_CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type MenuChangeStatus = (typeof MENU_CHANGE_STATUSES)[number];

/** Admin decision on a change request (doc 09: reject requires a reason). */
export const MENU_CHANGE_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type MenuChangeDecision = (typeof MENU_CHANGE_DECISIONS)[number];

export const DIETARY_TYPES = ['VEGETARIAN', 'NON_VEG', 'EGG'] as const;
export type DietaryType = (typeof DIETARY_TYPES)[number];

/** Customer lifecycle (doc 08 `CustomerStatus`) — M09 Customers. */
export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Registration source (doc 08 `customers.source`, Figma "Registration Source", D28). */
export const CUSTOMER_SOURCES = ['APP', 'ADMIN', 'REFERRAL', 'OTHER'] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

/** Doc 08 `user_type` — one value exists today. */
export const USER_TYPES = ['CUSTOMER'] as const;
export type UserType = (typeof USER_TYPES)[number];

/**
 * D169 reward-point ledger kinds (doc 09 /customers/{id}/rewards; append-only
 * ledger — corrections are new rows). ORDER_* / CHECKOUT_REDEEM / EXPIRY are
 * written by the orders/checkout flows; MANUAL_* / WALLET_CONVERT are the
 * admin-panel actions.
 */
export const REWARD_ENTRY_TYPES = [
  'ORDER_EARN',
  'ORDER_REVERSAL',
  'MANUAL_GRANT',
  'MANUAL_DEDUCT',
  'CHECKOUT_REDEEM',
  'WALLET_CONVERT',
  'EXPIRY',
] as const;
export type RewardEntryType = (typeof REWARD_ENTRY_TYPES)[number];

/** The admin grant/deduct action (POST /customers/{id}/rewards/adjust). */
export const REWARD_ADJUST_ACTIONS = ['grant', 'deduct'] as const;
export type RewardAdjustAction = (typeof REWARD_ADJUST_ACTIONS)[number];

/** D169(4) / D24 wallet ledger kinds (doc 16 append-only). */
export const WALLET_ENTRY_TYPES = [
  'REWARD_CONVERT',
  'REFUND_CREDIT',
  'ORDER_DEBIT',
  'MANUAL_ADJUST',
] as const;
export type WalletEntryType = (typeof WALLET_ENTRY_TYPES)[number];

/**
 * Delivery partner lifecycle (doc 10 §5): PENDING_VERIFICATION → VERIFIED →
 * ACTIVE ↔ INACTIVE; SUSPENDED. The online flag (`is_online`) is separate.
 */
export const DELIVERY_PARTNER_STATUSES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
] as const;
export type DeliveryPartnerStatus = (typeof DELIVERY_PARTNER_STATUSES)[number];

/**
 * Settlement cycle for a delivery partner's earnings/cash (task Figma
 * "Settlement" column). PENDING = not settled, PARTIAL = part of the period
 * paid out, SETTLED = fully settled. Real settlement runs land with M13
 * (doc 16 `cash_settlements`); until then the column carries the seeded or
 * admin-set state only.
 */
export const PARTNER_SETTLEMENT_STATUSES = ['PENDING', 'PARTIAL', 'SETTLED'] as const;
export type PartnerSettlementStatus = (typeof PARTNER_SETTLEMENT_STATUSES)[number];

/**
 * Third-party delivery provider lifecycle (task: Third-Party Partners page).
 * ACTIVE ⇄ INACTIVE is the enable/disable lever; SUSPENDED parks a provider
 * after a problem, mirroring the vendor/partner lifecycle style (doc 10).
 */
export const THIRD_PARTY_PROVIDER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type ThirdPartyProviderStatus = (typeof THIRD_PARTY_PROVIDER_STATUSES)[number];

/**
 * Integration configuration state — a status flag only. CONFIGURED means an
 * admin marked the provider's integration setup complete; it never implies a
 * live API connection (no credentials or connectivity exist yet — see the
 * task constraint and the handoff gap note).
 */
export const INTEGRATION_STATUSES = ['NOT_CONFIGURED', 'CONFIGURED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
