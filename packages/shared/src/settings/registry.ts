import { z } from 'zod';
import { mfaPolicySchema, DEFAULT_SECURITY_POLICY } from '../auth-mfa';

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

/** D97 document checklist; D113: Home Food stays not configured (null) until the owner confirms it. */
export const ONBOARDING_DOCUMENT_TYPES = [
  'FSSAI',
  'GST',
  'PAN',
  'BANK_DETAILS',
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'ID_PROOF',
] as const;
const documentList = z
  .array(z.enum(ONBOARDING_DOCUMENT_TYPES))
  .max(ONBOARDING_DOCUMENT_TYPES.length)
  .refine((l) => new Set(l).size === l.length, 'must not repeat a document');
export const onboardingDocumentsSchema = z
  .object({
    RESTAURANT: documentList,
    DELIVERY_PARTNER: documentList,
    HOME_FOOD: documentList.nullable(),
  })
  .strict();

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
    description: 'Documents an application must include. Applies to new applications only.',
    schema: onboardingDocumentsSchema,
    default: {
      RESTAURANT: ['FSSAI', 'GST', 'PAN', 'BANK_DETAILS'],
      DELIVERY_PARTNER: ['DRIVING_LICENCE', 'VEHICLE_RC', 'ID_PROOF', 'BANK_DETAILS'],
      HOME_FOOD: null,
    },
    zoneOverride: false,
    reauth: 'PASSWORD',
    editable: true,
    appsRead: false,
    effect: pending('Onboarding requests'),
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
