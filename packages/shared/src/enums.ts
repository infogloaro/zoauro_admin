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

export const DIETARY_TYPES = ['VEGETARIAN', 'NON_VEG', 'EGG'] as const;
export type DietaryType = (typeof DIETARY_TYPES)[number];
