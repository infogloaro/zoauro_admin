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
