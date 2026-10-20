import { z } from 'zod';
import { mfaPolicySchema, DEFAULT_SECURITY_POLICY } from '../auth-mfa';
import { MAX_DELIVERY_CHARGE_PAISE } from '../zones/schemas';

// Platform settings registry (doc 59 §2–3, owner decisions D109–D116). One typed list: every setting's key, group,
// value schema, the decided default ("the default rule"), whether a zone may override it, the re-authentication it needs
// (D112) and what it does today. effective(key, zone) = zone override ?? platform value ?? code default (D109).
// Secrets are never setting values (credentials stay in the server environment).

/** paise; D106: the highest amount anyone can type is INR 1,00,000 */
const MAX_PAISE = 1_00_000 * 100;
const paise = z.number().int().min(0).max(MAX_PAISE);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24 h)');

export const SETTING_GROUPS = [
  'refunds',
  'onboarding',
  'support',
  'notifications',
  'orders',
  'sms',
  'loyalty',
  'security',
  'payouts',
  'zones',
  'access',
  'sessions',
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/** Today's effect, shown as a badge so no switch pretends to work (doc 59 §2). NOT_CONFIGURED is computed (value null). */
export type SettingEffect = { state: 'ENFORCED' } | { state: 'PENDING_MODULE'; module: string };

// ---- value schemas ------------------------------------------------------------------------------------------------

/** D110 + D95: zone caps for every Zonal Admin and the amount above which a second approver is needed. */
export const refundLimitsSchema = z
  .object({
    perRefundPaise: paise,
    perDayPaise: paise,
    secondApproverAbovePaise: paise,
  })
  .strict()
  .refine((v) => v.perDayPaise >= v.perRefundPaise, {
    path: ['perDayPaise'],
    message: 'the day cap cannot be lower than the per-refund cap',
  });

/** D96: deliberately not configured until management confirms the values (null = refunds rules off). */
export const REFUND_COST_BEARERS = ['VENDOR', 'PLATFORM', 'SHARED'] as const;
export const refundRulesSchema = z
  .object({
    cancellationWindowMinutes: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60),
    reasons: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    costBearer: z.enum(REFUND_COST_BEARERS),
  })
  .strict()
  .nullable();

/** The D97 vocabulary (the first codes of the catalogue; the web labels them). */
export const ONBOARDING_DOCUMENT_TYPES = [
  'FSSAI',
  'GST',
  'PAN',
  'BANK_DETAILS',
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'ID_PROOF',
] as const;

/**
 * D145: the onboarding document catalogue is dynamic. Per party the Super Admin adds, edits, removes and orders document
 * types (array order = display order) and marks each mandatory or optional. A party with null is not configured (no
 * checklist). A code is upper case (A–Z, 0–9, _); OTHER is reserved for uploads outside the catalogue.
 */
export const ONBOARDING_PARTIES = ['RESTAURANT', 'HOMEMAKER', 'DELIVERY_PARTNER', 'HOTEL'] as const;
export type OnboardingParty = (typeof ONBOARDING_PARTIES)[number];
export const DOCUMENT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
/** OTHER: a document outside the checklist (doc 32); never a catalogue entry. */
export const OTHER_DOCUMENT_CODE = 'OTHER';
export const documentCodeSchema = z
  .string()
  .regex(DOCUMENT_CODE_PATTERN, 'capital letters, digits and _ (2 to 40), starting with a letter');
export const ONBOARDING_DOCUMENTS_PER_PARTY_MAX = 30;
export const onboardingDocumentTypeSchema = z
  .object({
    code: documentCodeSchema.refine((c) => c !== OTHER_DOCUMENT_CODE, 'OTHER is reserved'),
    label: z.string().trim().min(2).max(60),
    mandatory: z.boolean(),
  })
  .strict();
export type OnboardingDocumentType = z.infer<typeof onboardingDocumentTypeSchema>;
const documentCatalogue = z
  .array(onboardingDocumentTypeSchema)
  .max(ONBOARDING_DOCUMENTS_PER_PARTY_MAX)
  .refine((l) => new Set(l.map((d) => d.code)).size === l.length, 'must not repeat a document')
  .nullable();

/** Labels of the built-in codes (the D97 and D145 defaults); a value saved before D145 is upgraded with them. */
export const BUILT_IN_DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  FSSAI: 'FSSAI licence',
  GST: 'GST certificate',
  PAN: 'PAN card',
  BANK_DETAILS: 'Bank details',
  DRIVING_LICENCE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  ID_PROOF: 'ID proof',
  FSSAI_REGISTRATION: 'FSSAI registration',
  ADDRESS_PROOF: 'Address proof',
  KITCHEN_PHOTOS: 'Kitchen photos',
};

/** Before D145 the value was { RESTAURANT, DELIVERY_PARTNER, HOME_FOOD } as lists of mandatory codes. */
function upgradeLegacyDocuments(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if (!('HOME_FOOD' in o)) return raw;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.map((c: unknown) => ({
          code: c,
          label: typeof c === 'string' ? (BUILT_IN_DOCUMENT_LABELS[c] ?? c) : c,
          mandatory: true,
        }))
      : v;
  return {
    RESTAURANT: list(o['RESTAURANT']),
    HOMEMAKER: list(o['HOME_FOOD']),
    DELIVERY_PARTNER: list(o['DELIVERY_PARTNER']),
    HOTEL: null,
  };
}

export const onboardingDocumentsSchema = z.preprocess(
  upgradeLegacyDocuments,
  z
    .object({
      RESTAURANT: documentCatalogue,
      HOMEMAKER: documentCatalogue,
      DELIVERY_PARTNER: documentCatalogue,
      HOTEL: documentCatalogue,
    })
    .strict(),
);
export type OnboardingDocuments = z.infer<typeof onboardingDocumentsSchema>;

const doc = (code: string, mandatory = true): OnboardingDocumentType => ({
  code,
  label: BUILT_IN_DOCUMENT_LABELS[code] ?? code,
  mandatory,
});
/** D97 (restaurants, partners) and D145 (homemakers); hotels: no list was decided, so not configured. */
export const DEFAULT_ONBOARDING_DOCUMENTS: OnboardingDocuments = {
  RESTAURANT: [doc('FSSAI'), doc('GST'), doc('PAN'), doc('BANK_DETAILS')],
  HOMEMAKER: [
    doc('FSSAI_REGISTRATION'),
    doc('ID_PROOF'),
    doc('ADDRESS_PROOF'),
    doc('BANK_DETAILS'),
    doc('PAN', false),
    doc('KITCHEN_PHOTOS', false),
  ],
  DELIVERY_PARTNER: [
    doc('DRIVING_LICENCE'),
    doc('VEHICLE_RC'),
    doc('ID_PROOF'),
    doc('BANK_DETAILS'),
  ],
  HOTEL: null,
};

// ---- orders, dispatch, payouts, zones, access, sessions (D154–D167) -----------------------------------------------

/**
 * D161 (D52): an unpaid prepaid order stays hidden and is cancelled (PAYMENT_TIMEOUT) after these minutes. COD has no
 * timeout (visible at once), so it is not a key.
 */
export const orderUnpaidTimeoutSchema = z
  .object({
    ONLINE: z.number().int().min(5).max(120),
    WALLET: z.number().int().min(5).max(120),
  })
  .strict();

/**
 * D156 (R-ORD-3): who may cancel while the order is still before which status. After the admin's stage only an admin
 * with a refund decision can end the order.
 */
export const CANCELLATION_STAGES = [
  'ACCEPTED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;
const cancelRule = z
  .object({ allowedBefore: z.enum(CANCELLATION_STAGES), reasonRequired: z.boolean() })
  .strict();
export const orderCancellationRulesSchema = z
  .object({ CUSTOMER: cancelRule, VENDOR: cancelRule, ADMIN: cancelRule })
  .strict()
  .superRefine((v, ctx) => {
    const at = (s: (typeof CANCELLATION_STAGES)[number]) => CANCELLATION_STAGES.indexOf(s);
    for (const who of ['CUSTOMER', 'VENDOR'] as const)
      if (at(v[who].allowedBefore) > at(v.ADMIN.allowedBefore))
        ctx.addIssue({
          code: 'custom',
          path: ['ADMIN', 'allowedBefore'],
          message: 'admins must be able to cancel at least as late as customers and vendors',
        });
    if (!v.ADMIN.reasonRequired)
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN', 'reasonRequired'],
        message: 'an admin cancellation always needs a reason',
      });
  });

/** D167: pre-orders (hotels, scheduled delivery). */
export const orderPreorderSchema = z
  .object({
    minLeadMinutes: z
      .number()
      .int()
      .min(15)
      .max(24 * 60),
    maxAheadDays: z.number().int().min(1).max(30),
    travelBufferMinutes: z.number().int().min(0).max(180),
    /** used when the vendor has no average preparation time */
    prepMinutes: z.number().int().min(5).max(240),
    /** before dispatch */
    cancelCutoffMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    rescheduleCutoffMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    maxReschedules: z.number().int().min(0).max(10),
  })
  .strict()
  .refine((v) => v.minLeadMinutes < v.maxAheadDays * 24 * 60, {
    path: ['minLeadMinutes'],
    message: 'the lead time must be shorter than the booking horizon',
  });

/** D154: per zone, OFF by default; nearest available partner within the radius, offered in turn with a timeout. */
export const deliveryAutoAssignSchema = z
  .object({
    enabled: z.boolean(),
    radiusKm: z.number().min(0.5).max(50).multipleOf(0.1),
    offerTimeoutSeconds: z.number().int().min(15).max(600),
  })
  .strict();

/** D152 */
export const payoutCycleSchema = z.object({ days: z.number().int().min(1).max(31) }).strict();

/** D165 (D86): the most a zone's delivery charge may be; the zones module checks every create and edit against it. */
/** At most the database ceiling (₹1 000) until a migration raises it. */
export const zoneDeliveryChargeCapSchema = z
  .object({ capPaise: z.number().int().min(0).max(MAX_DELIVERY_CHARGE_PAISE) })
  .strict();

/** D155: commission:edit can be given to a Zonal Admin per member and zone only while this is on. */
export const commissionEditGrantableSchema = z.object({ enabled: z.boolean() }).strict();

/** D163 (D79): "remember me" absolute lifetime and idle limit. */
export const sessionRememberSchema = z
  .object({
    rememberDays: z.number().int().min(1).max(30),
    rememberIdleHours: z.number().int().min(1).max(72),
  })
  .strict()
  .refine((v) => v.rememberIdleHours <= v.rememberDays * 24, {
    path: ['rememberIdleHours'],
    message: 'the idle limit cannot be longer than the session',
  });

/** D98 */
export const SUPPORT_ASSIGNMENT = ['ROUND_ROBIN', 'LEAST_BUSY'] as const;
export const supportSlaSchema = z
  .object({
    firstResponseMinutes: z
      .number()
      .int()
      .min(5)
      .max(7 * 24 * 60),
    resolutionMinutes: z
      .number()
      .int()
      .min(15)
      .max(30 * 24 * 60),
    escalationMinutes: z
      .number()
      .int()
      .min(5)
      .max(30 * 24 * 60),
    reopenWithinDays: z.number().int().min(0).max(90),
    assignment: z.enum(SUPPORT_ASSIGNMENT),
  })
  .strict()
  .refine((v) => v.escalationMinutes <= v.resolutionMinutes, {
    path: ['escalationMinutes'],
    message: 'escalation must come before the resolution deadline',
  });

/**
 * D100: promotional messages are sent only inside this window (Asia/Kolkata). Order updates are never held, nor are
 * security or legal notices (a rule in code, not a setting).
 */
export const notificationTimingSchema = z
  .object({ promotionalFrom: hhmm, promotionalTo: hhmm })
  .strict()
  .refine((v) => v.promotionalFrom < v.promotionalTo, {
    path: ['promotionalTo'],
    message: 'the window must end after it starts',
  });

/** D99: in-app and email first; SMS only with a ready provider; WhatsApp has no provider yet. */
export const notificationChannelsSchema = z
  .object({ inApp: z.boolean(), email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean() })
  .strict()
  .refine((v) => !v.whatsapp, {
    path: ['whatsapp'],
    message: 'no WhatsApp provider is set up yet',
  });

/** D88, D114: placeholders {ZONE} (zone code), {SEQ} (per-zone sequence, required), {YYYY}, {MM}. */
export const ORDER_NUMBER_PLACEHOLDERS = ['{ZONE}', '{SEQ}', '{YYYY}', '{MM}'] as const;
export const orderNumberFormatSchema = z
  .object({
    template: z
      .string()
      .trim()
      .min(5)
      .max(40)
      .regex(
        /^([A-Z0-9_/-]|\{ZONE\}|\{SEQ\}|\{YYYY\}|\{MM\})+$/,
        'letters A–Z, digits, - _ / and the placeholders only',
      )
      .refine((t) => t.split('{SEQ}').length === 2, 'must contain {SEQ} exactly once'),
  })
  .strict();

/** D121: orders one delivery partner may carry at once (1 = one at a time); checked when an order is assigned. */
export const MAX_ORDERS_PER_PARTNER = 5;
export const deliveryMaxConcurrentOrdersSchema = z
  .object({ perPartner: z.number().int().min(1).max(MAX_ORDERS_PER_PARTNER) })
  .strict();

/** D68: the provider and its non-secret identifiers; the API key stays in the server environment. */
export const SMS_PROVIDER_CHOICES = ['MSG91', 'NONE'] as const;
export const smsProviderSchema = z
  .object({
    provider: z.enum(SMS_PROVIDER_CHOICES),
    senderId: z
      .string()
      .regex(/^[A-Z]{6}$/, 'a DLT sender ID is 6 capital letters')
      .nullable(),
    dltTemplateIdOtp: z
      .string()
      .regex(/^\d{10,25}$/, 'a DLT template ID is 10 to 25 digits')
      .nullable(),
  })
  .strict();

/** D101: every loyalty value is a Super Admin setting with no default (null = loyalty off). */
export const loyaltyValuesSchema = z
  .object({
    earnRatePercent: z.number().min(0).max(100),
    pointsExpiryDays: z.number().int().min(1).max(3650),
    pointValuePaise: z.number().int().min(1).max(10_000),
  })
  .strict()
  .nullable();

// ---- the registry -------------------------------------------------------------------------------------------------

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  schema: z.ZodType;
  /** the decided rule (null = deliberately not configured) */
  default: unknown;
  /** a zone may have its own value (D109) */
  zoneOverride: boolean;
  /** D112 */
  reauth: 'PASSWORD' | 'STRONG';
  /** false: changed through its own screen and route (security.mfa: PUT /settings/security) */
  editable: boolean;
  /** the customer, vendor or partner apps read it (a change emits config.changed); none yet */
  appsRead: boolean;
  effect: SettingEffect;
}

const pending = (module: string): SettingEffect => ({ state: 'PENDING_MODULE', module });

export const SETTINGS: readonly SettingDef[] = [
  {
    key: 'refunds.limits',
    group: 'refunds',
    label: 'Refund limits (zone caps)',
    description:
      'The most any Zonal Admin may refund at once and per day in a zone, and the amount above which a second approver is needed. A member’s own limit can never be saved above the cap.',
    schema: refundLimitsSchema,
    default: {
      perRefundPaise: 1_000_00,
      perDayPaise: 5_000_00,
      secondApproverAbovePaise: 10_000_00,
    },
    zoneOverride: true,
    reauth: 'STRONG',
    editable: true,
    appsRead: false,
    effect: { state: 'ENFORCED' },
  },
  {
    key: 'refunds.rules',
    group: 'refunds',
    label: 'Refund rules',
    description:
      'Cancellation window, refund reasons and who bears the cost. Not configured until management confirms the values (D96).',
    schema: refundRulesSchema,
    default: null,
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Refunds'),
  },
  {
    key: 'onboarding.documents',
    group: 'onboarding',
    label: 'Onboarding documents',
    description:
      'Document types per party (restaurant, homemaker, delivery partner, hotel), in display order, each mandatory or optional. The vendor and partner screens show it as the checklist. A party left empty has no checklist.',
    schema: onboardingDocumentsSchema,
    default: DEFAULT_ONBOARDING_DOCUMENTS,
    zoneOverride: false,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: { state: 'ENFORCED' },
  },
  {
    key: 'support.sla',
    group: 'support',
    label: 'Support response times',
    description:
      'First reply, resolution and escalation times, how long a closed ticket can be reopened, and how tickets are assigned.',
    schema: supportSlaSchema,
    default: {
      firstResponseMinutes: 120,
      resolutionMinutes: 1440,
      escalationMinutes: 720,
      reopenWithinDays: 7,
      assignment: 'ROUND_ROBIN',
    },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Support desk'),
  },
  {
    key: 'notifications.timing',
    group: 'notifications',
    label: 'Notification timing',
    description:
      'Promotional messages go out only inside this window (Asia/Kolkata). Order updates, security and legal notices are never held.',
    schema: notificationTimingSchema,
    default: { promotionalFrom: '09:00', promotionalTo: '21:00' },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Notifications'),
  },
  {
    key: 'notifications.channels',
    group: 'notifications',
    label: 'Notification channels',
    description: 'In-app and email first; SMS once the provider is ready; WhatsApp later.',
    schema: notificationChannelsSchema,
    default: { inApp: true, email: true, sms: false, whatsapp: false },
    zoneOverride: false,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Notifications'),
  },
  {
    key: 'orders.numberFormat',
    group: 'orders',
    label: 'Order number format',
    description:
      'Applies to orders created after saving; existing numbers never change; the sequence continues per zone.',
    schema: orderNumberFormatSchema,
    default: { template: 'ZO-{ZONE}-{SEQ}' },
    zoneOverride: false,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Orders'),
  },
  {
    key: 'delivery.maxConcurrentOrders',
    group: 'orders',
    label: 'Orders per delivery partner',
    description:
      'How many orders one delivery partner may carry at the same time. 1 means one order at a time; raise it to allow batching.',
    schema: deliveryMaxConcurrentOrdersSchema,
    default: { perPartner: 1 },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Orders'),
  },
  {
    key: 'orders.unpaidTimeoutMinutes',
    group: 'orders',
    label: 'Unpaid order timeout',
    description:
      'An online or wallet order that is not paid stays hidden from the vendor and is cancelled after these minutes. Cash on delivery orders are visible at once.',
    schema: orderUnpaidTimeoutSchema,
    default: { ONLINE: 15, WALLET: 15 },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Payments (payment timeout job)'),
  },
  {
    key: 'orders.cancellationRules',
    group: 'orders',
    label: 'Cancellation windows',
    description:
      'Who may cancel an order until which stage, and whether a reason is needed. After the admin stage only an admin with a refund decision can end the order.',
    schema: orderCancellationRulesSchema,
    default: {
      CUSTOMER: { allowedBefore: 'ACCEPTED', reasonRequired: false },
      VENDOR: { allowedBefore: 'PREPARING', reasonRequired: true },
      ADMIN: { allowedBefore: 'OUT_FOR_DELIVERY', reasonRequired: true },
    },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Orders (cancellation)'),
  },
  {
    key: 'orders.preorder',
    group: 'orders',
    label: 'Pre-order rules',
    description:
      'How early and how far ahead a pre-order can be placed, the travel buffer and default preparation time used to start dispatch, and the cancel and reschedule cut-offs.',
    schema: orderPreorderSchema,
    default: {
      minLeadMinutes: 60,
      maxAheadDays: 7,
      travelBufferMinutes: 20,
      prepMinutes: 30,
      cancelCutoffMinutes: 30,
      rescheduleCutoffMinutes: 30,
      maxReschedules: 2,
    },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Pre-orders'),
  },
  {
    key: 'delivery.autoAssign',
    group: 'orders',
    label: 'Auto-assign delivery partners',
    description:
      'When on, a ready order is offered to the nearest available partner (online, active, verified, under the order cap) within the radius, one at a time with a timeout; if nobody accepts it falls back to manual assignment with an alert.',
    schema: deliveryAutoAssignSchema,
    default: { enabled: false, radiusKm: 5, offerTimeoutSeconds: 60 },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Dispatch (auto-assign)'),
  },
  {
    key: 'payouts.cycleDays',
    group: 'payouts',
    label: 'Payout cycle',
    description:
      'Days between vendor payouts. Vendor-fault refunds are deducted in the cycle in which they are decided.',
    schema: payoutCycleSchema,
    default: { days: 7 },
    zoneOverride: true,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Payouts'),
  },
  {
    key: 'zones.deliveryChargeCapPaise',
    group: 'zones',
    label: 'Delivery charge cap',
    description:
      'The highest delivery charge a zone can be given. Existing zones keep their charge.',
    schema: zoneDeliveryChargeCapSchema,
    default: { capPaise: MAX_DELIVERY_CHARGE_PAISE },
    zoneOverride: false,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: { state: 'ENFORCED' },
  },
  {
    key: 'access.commissionEditGrantable',
    group: 'access',
    label: 'Commission edit for Zonal Admins',
    description:
      'When on, the Super Admin can give a Zonal Admin commission edit for one zone in the member’s access overrides. When off, no Zonal Admin can edit commission, whatever was granted.',
    schema: commissionEditGrantableSchema,
    default: { enabled: false },
    zoneOverride: false,
    reauth: 'STRONG',
    editable: true,
    appsRead: false,
    effect: { state: 'ENFORCED' },
  },
  {
    key: 'sessions.remember',
    group: 'sessions',
    label: '“Remember me” sessions',
    description:
      'How long a “remember me” sign-in lasts and how long it may stay idle. Applies to new sign-ins.',
    schema: sessionRememberSchema,
    default: { rememberDays: 7, rememberIdleHours: 8 },
    zoneOverride: false,
    reauth: 'STRONG',
    editable: true,
    appsRead: false,
    effect: pending('Sign-in (the server reads its environment today)'),
  },
  {
    key: 'sms.provider',
    group: 'sms',
    label: 'SMS provider',
    description:
      'The provider and its DLT sender and template IDs. The API key stays in the server environment.',
    schema: smsProviderSchema,
    default: { provider: 'MSG91', senderId: null, dltTemplateIdOtp: null },
    zoneOverride: false,
    reauth: 'STRONG',
    editable: true,
    appsRead: false,
    effect: pending('SMS sending (the server reads its environment today)'),
  },
  {
    key: 'loyalty.values',
    group: 'loyalty',
    label: 'Loyalty values',
    description:
      'Earn rate, expiry and point value. No defaults: loyalty stays off until they are set (D101).',
    schema: loyaltyValuesSchema,
    default: null,
    zoneOverride: false,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Loyalty (Phase 2)'),
  },
  {
    key: 'security.mfa',
    group: 'security',
    label: '2-step verification policy',
    description: 'Changed in Settings > Security (password and a 2-step code).',
    schema: mfaPolicySchema,
    default: DEFAULT_SECURITY_POLICY.mfa,
    zoneOverride: false,
    reauth: 'STRONG',
    editable: false,
    appsRead: false,
    effect: { state: 'ENFORCED' },
  },
];

export const SETTING_KEYS = SETTINGS.map((s) => s.key) as [string, ...string[]];

export function settingDef(key: string): SettingDef | undefined {
  return SETTINGS.find((s) => s.key === key);
}

export const settingsOfGroup = (group: SettingGroup): SettingDef[] =>
  SETTINGS.filter((s) => s.group === group);

/** D109 */
export function effectiveSetting(
  def: SettingDef,
  platform: { value: unknown } | null,
  zone: { value: unknown } | null,
): { value: unknown; source: 'DEFAULT' | 'PLATFORM' | 'ZONE' } {
  if (zone && def.zoneOverride) return { value: zone.value, source: 'ZONE' };
  if (platform) return { value: platform.value, source: 'PLATFORM' };
  return { value: def.default, source: 'DEFAULT' };
}

/** D114 preview: the number the next order of a zone would get. */
export function renderOrderNumber(
  template: string,
  zoneCode: string,
  seq: number,
  at: Date,
): string {
  return template
    .replace('{ZONE}', zoneCode)
    .replace('{SEQ}', String(seq).padStart(6, '0'))
    .replace('{YYYY}', String(at.getUTCFullYear()))
    .replace('{MM}', String(at.getUTCMonth() + 1).padStart(2, '0'));
}
