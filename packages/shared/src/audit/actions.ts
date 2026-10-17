// Audit action catalogue (doc 50 section 4). Add an action here BEFORE using it in a service.
export const AUDIT_MODULES = [
  'auth',
  'zones',
  'admins',
  'access',
  'restaurants',
  'homemakers',
  'menu',
  'customers',
  'delivery',
  'orders',
  'payments',
  'refunds',
  'settlements',
  'payouts',
  'settings',
  'integrations',
  'notifications',
  'audit',
  'system',
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];
export type AuditSensitivity = 'NORMAL' | 'HIGH';
export type AuditActionDef = { module: AuditModule; label: string; sensitivity: AuditSensitivity };

const N = 'NORMAL' as const;
const H = 'HIGH' as const;
const a = (
  module: AuditModule,
  label: string,
  sensitivity: AuditSensitivity = N,
): AuditActionDef => ({ module, label, sensitivity });

export const AUDIT_ACTIONS = {
  // auth
  'user.two_factor_enrolled': a('auth', 'Enrolled two-factor authentication'),
  'user.password_changed': a('auth', 'Changed password'),
  'user.password_reset_requested': a('auth', 'Requested password reset'),
  'user.locked': a('auth', 'Account locked'),
  'user.unlocked': a('auth', 'Account unlocked'),
  'session.revoked': a('auth', 'Revoked session'),
  'reauth.failed': a('auth', 'Failed re-authentication', H),
  // auth: 2-step verification (doc 52 section 4)
  'user.two_factor_disabled': a('auth', 'Removed a two-factor method', H),
  'user.two_factor_reset': a('auth', 'Reset two-factor authentication', H),
  'user.backup_codes_generated': a('auth', 'Generated backup codes', H),
  'user.backup_code_used': a('auth', 'Used a backup code', H),
  'user.mfa_challenge_failed': a('auth', 'Failed two-factor challenge'),
  'user.mfa_locked': a('auth', 'Account locked after two-factor failures', H),
  'sms.paused': a('auth', 'Paused SMS sending', H),
  'sms.resumed': a('auth', 'Resumed SMS sending', H),
  // zones
  'zone.created': a('zones', 'Created zone'),
  'zone.updated': a('zones', 'Updated zone'),
  'zone.deactivated': a('zones', 'Deactivated zone', H), // HIGH per doc 50 section 4
  'zone.activated': a('zones', 'Activated zone'),
  // doc 53 section 4
  'zone.delivery_charge_changed': a('zones', 'Changed delivery charge', H),
  'zone.pincodes_changed': a('zones', 'Changed pincodes', H),
  'zone.deleted': a('zones', 'Deleted zone'),
  // D92: a service switched on or off in a zone (switching off stops new business for it there)
  'zone.services_changed': a('zones', 'Changed zone services', H),
  // members and access
  'member.created': a('admins', 'Created member account'),
  'member.updated': a('admins', 'Updated member account'),
  'member.suspended': a('admins', 'Suspended member'),
  'member.reactivated': a('admins', 'Reactivated member'),
  'member.password_reset': a('admins', 'Reset member password', H),
  // D102: soft delete that ends assignments and sessions (not named in doc 50 section 4; doc 32)
  'member.deleted': a('admins', 'Deleted member account', H),
  'access.profile_set': a('access', 'Set access profile', H),
  'access.override_set': a('access', 'Set access override', H),
  'access.limit_set': a('access', 'Set access limit', H),
  'access.zone_added': a('access', 'Added member to zone', H),
  'access.zone_removed': a('access', 'Removed member from zone', H),
  // R13 access requests (doc 59, D115)
  'access.request_created': a('access', 'Requested access'),
  'access.request_cancelled': a('access', 'Cancelled access request'),
  'access.request_approved': a('access', 'Approved access request', H),
  'access.request_rejected': a('access', 'Rejected access request'),
  'access_profile.created': a('access', 'Created access profile', H),
  'access_profile.updated': a('access', 'Updated access profile', H),
  'access_profile.deleted': a('access', 'Deleted access profile', H),
  // restaurants
  'restaurant.created': a('restaurants', 'Created restaurant'),
  'restaurant.updated': a('restaurants', 'Updated restaurant'),
  'restaurant.deleted': a('restaurants', 'Deleted restaurant'),
  'restaurant.verified': a('restaurants', 'Verified restaurant', H),
  'restaurant.rejected': a('restaurants', 'Rejected restaurant', H),
  'restaurant.activated': a('restaurants', 'Activated restaurant', H),
  'restaurant.deactivated': a('restaurants', 'Deactivated restaurant', H),
  'restaurant.suspended': a('restaurants', 'Suspended restaurant', H),
  'restaurant.commission_changed': a('restaurants', 'Changed commission', H),
  'restaurant.zone_moved': a('restaurants', 'Moved to another zone', H),
  'restaurant.document_added': a('restaurants', 'Added document'),
  'restaurant.document_viewed': a('restaurants', 'Viewed document', H),
  // D120, D123
  'restaurant.document_verified': a('restaurants', 'Verified document', H),
  'restaurant.document_rejected': a('restaurants', 'Rejected document', H),
  'restaurant.contact_revealed': a('restaurants', 'Revealed contact details', H),
  // homemakers
  'homemaker.created': a('homemakers', 'Created homemaker'),
  'homemaker.updated': a('homemakers', 'Updated homemaker'),
  'homemaker.deleted': a('homemakers', 'Deleted homemaker'),
  'homemaker.verified': a('homemakers', 'Verified homemaker', H),
  'homemaker.rejected': a('homemakers', 'Rejected homemaker', H),
  'homemaker.activated': a('homemakers', 'Activated homemaker', H),
  'homemaker.deactivated': a('homemakers', 'Deactivated homemaker', H),
  'homemaker.suspended': a('homemakers', 'Suspended homemaker', H),
  'homemaker.commission_changed': a('homemakers', 'Changed commission', H),
  'homemaker.zone_moved': a('homemakers', 'Moved to another zone', H),
  'homemaker.document_added': a('homemakers', 'Added document'),
  'homemaker.document_viewed': a('homemakers', 'Viewed document', H),
  // D120, D123
  'homemaker.document_verified': a('homemakers', 'Verified document', H),
  'homemaker.document_rejected': a('homemakers', 'Rejected document', H),
  'homemaker.contact_revealed': a('homemakers', 'Revealed contact details', H),
  // menu
  'menu_item.created': a('menu', 'Created menu item'),
  'menu_item.updated': a('menu', 'Updated menu item'),
  'menu_item.deleted': a('menu', 'Deleted menu item'),
  'menu_item.admin_disabled': a('menu', 'Disabled menu item (admin)'),
  'menu_item.bulk_updated': a('menu', 'Bulk updated menu items'),
  // customers
  'customer.created': a('customers', 'Created customer'),
  'customer.updated': a('customers', 'Updated customer'),
  'customer.blocked': a('customers', 'Blocked customer', H),
  'customer.unblocked': a('customers', 'Unblocked customer', H),
  'customer.contact_revealed': a('customers', 'Revealed contact details', H),
  // delivery partners
  'partner.created': a('delivery', 'Created delivery partner'),
  'partner.updated': a('delivery', 'Updated delivery partner'),
  'partner.verified': a('delivery', 'Verified delivery partner', H),
  'partner.rejected': a('delivery', 'Rejected delivery partner', H),
  'partner.suspended': a('delivery', 'Suspended delivery partner', H),
  'partner.force_offline': a('delivery', 'Forced partner offline', H),
  'partner.document_viewed': a('delivery', 'Viewed document', H),
  // orders
  'order.cancelled_by_admin': a('orders', 'Cancelled order (admin)'),
  'order.accepted_on_behalf': a('orders', 'Accepted order on vendor behalf'),
  'order.partner_assigned': a('orders', 'Assigned delivery partner'),
  'order.partner_reassigned': a('orders', 'Reassigned delivery partner'),
  'order.status_changed': a('orders', 'Changed order status'),
  'order.marked_delayed': a('orders', 'Marked order delayed'),
  'order.exported': a('orders', 'Exported orders', H),
  // money
  'refund.requested': a('refunds', 'Requested refund'),
  'refund.approved': a('refunds', 'Approved refund', H),
  'refund.rejected': a('refunds', 'Rejected refund', H),
  'refund.processed': a('refunds', 'Processed refund'),
  'refund.failed': a('refunds', 'Refund failed'),
  'cod_settlement.confirmed': a('settlements', 'Confirmed COD settlement', H),
  'payout.generated': a('payouts', 'Generated payout'),
  'payout.marked_paid': a('payouts', 'Marked payout paid', H),
  'reconciliation.mismatch_ack': a('payments', 'Acknowledged reconciliation mismatch', H),
  // settings
  'settings.updated': a('settings', 'Updated setting', H),
  'settings.2fa_policy_changed': a('settings', 'Changed two-factor policy', H),
  // doc 59 §5 (D109): reset to the default rule, and per-zone overrides
  'settings.reset': a('settings', 'Reset setting to default', H),
  'settings.zone_override_set': a('settings', 'Set zone setting', H),
  'settings.zone_override_removed': a('settings', 'Removed zone setting', H),
  // integrations
  'integration_client.created': a('integrations', 'Created integration client', H),
  'integration_client.rotated': a('integrations', 'Rotated integration secret', H),
  'integration_client.disabled': a('integrations', 'Disabled integration client', H),
  'integration_client.enabled': a('integrations', 'Enabled integration client', H),
  'webhook.created': a('integrations', 'Created webhook', H),
  'webhook.updated': a('integrations', 'Updated webhook', H),
  'webhook.paused': a('integrations', 'Paused webhook', H),
  'delivery.retried': a('integrations', 'Retried webhook delivery'),
  'registration.zone_assigned': a('integrations', 'Assigned zone to registration'),
  // notifications / audit / system
  'broadcast.created': a('notifications', 'Created broadcast', H),
  'audit.exported': a('audit', 'Exported audit log', H),
  'job.order_auto_cancelled': a('system', 'Order auto-cancelled'),
  'job.payment_expired': a('system', 'Payment expired'),
  'job.payout_run': a('system', 'Payout run'),
} as const satisfies Record<string, AuditActionDef>;

export type AuditActionKey = keyof typeof AUDIT_ACTIONS;
export const isAuditActionKey = (k: string): k is AuditActionKey =>
  Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, k);

/** Entity types that belong to exactly one zone: `zoneId` must be a string. */
export const ZONE_REQUIRED_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'restaurant',
  'homemaker',
  'menu_item',
  'partner',
  'order',
  'refund',
  'cod_settlement',
]);
/** Zone-related but the zone depends on context (e.g. customer): `zoneId` must be passed explicitly, `null` allowed. */
export const ZONE_EXPLICIT_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'customer',
  'payout',
  'payment',
]);

/** Modules a Zonal Admin can never read through the audit API (doc 50 §2.2). `admins` added as defence in depth. */
export const ZONAL_HIDDEN_AUDIT_MODULES: ReadonlySet<AuditModule> = new Set<AuditModule>([
  'access',
  'settings',
  'integrations',
  'zones',
  'audit',
  'admins',
  'auth',
  'system',
]);
