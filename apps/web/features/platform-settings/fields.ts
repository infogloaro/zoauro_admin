import {
  CANCELLATION_STAGES,
  ONBOARDING_DOCUMENT_TYPES,
  REFUND_COST_BEARERS,
  REFUND_TARGETS,
  SMS_PROVIDER_CHOICES,
  SUPPORT_ASSIGNMENT,
  settingDef,
} from '@zoauro/shared';
import { formatPaise } from '../audit/format';

// Platform settings forms (doc 59, D109–D116): one field list per registry key, the conversion between a stored value
// and the form's fields, client-side validation with the registry's own schema (the server validates again), and the
// one-line summaries the cards show. A field's path may be dotted ("autoApprove.trusted.minDeliveredOrders"); a "rows"
// field is a small table (refund reasons D146/D180, onboarding documents D145); a "checks" field picks several of a
// fixed list (refund targets). Pure, so it is tested without a browser.

export type FieldKind =
  | 'money'
  | 'minutes'
  | 'int'
  | 'number'
  | 'time'
  | 'bool'
  | 'select'
  | 'text'
  | 'lines'
  | 'checks'
  | 'rows';

/** A column of a "rows" field. A code column is upper case (A–Z, 0–9, _); a checks column picks any of its options. */
export interface ColumnSpec {
  key: string;
  label: string;
  kind: 'text' | 'code' | 'select' | 'bool' | 'checks';
  options?: readonly string[];
}

export interface FieldSpec {
  path: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  /** the columns of a "rows" field, and what a new row starts with */
  columns?: readonly ColumnSpec[];
  newRow?: DraftRow;
  hint?: string;
  /** the field itself may be "not configured" (null) */
  nullable?: boolean;
}

export interface KeySpec {
  fields: FieldSpec[];
  /** the whole value may be null: "not configured" (refund rules D96, loyalty D101) */
  nullable?: boolean;
}

export const DOCUMENT_LABEL: Record<(typeof ONBOARDING_DOCUMENT_TYPES)[number], string> = {
  FSSAI: 'FSSAI licence',
  GST: 'GST certificate',
  PAN: 'PAN',
  BANK_DETAILS: 'Bank details',
  DRIVING_LICENCE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  ID_PROOF: 'ID proof',
};

export const OPTION_LABEL: Record<string, string> = {
  VENDOR: 'Vendor',
  PLATFORM: 'ZOAURO',
  CUSTOMER: 'Customer',
  SHARED: 'Shared',
  ROUND_ROBIN: 'Round-robin',
  LEAST_BUSY: 'Least busy',
  MSG91: 'MSG91',
  NONE: 'None',
  SOURCE: 'Original payment method',
  WALLET: 'ZOAURO wallet',
  UPI: 'UPI',
  ADMIN: 'Admins',
  SYSTEM: 'System',
  // order stages (who may cancel until when, D156)
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  ASSIGNED: 'Partner assigned',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
};

const REASON_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', label: 'Code', kind: 'code' },
  { key: 'label', label: 'Reason', kind: 'text' },
  { key: 'bearer', label: 'Who pays', kind: 'select', options: REFUND_COST_BEARERS },
];
const DOC_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', label: 'Code', kind: 'code' },
  { key: 'label', label: 'Document', kind: 'text' },
  { key: 'mandatory', label: 'Required', kind: 'bool' },
];
const docs = (path: string, label: string, nullable = false): FieldSpec => ({
  path,
  label,
  kind: 'rows',
  columns: DOC_COLUMNS,
  newRow: { code: '', label: '', mandatory: true },
  nullable,
});

export const KEY_SPECS: Record<string, KeySpec> = {
  'refunds.limits': {
    fields: [
      { path: 'perRefundPaise', label: 'Per refund cap', kind: 'money' },
      { path: 'perDayPaise', label: 'Per day cap', kind: 'money' },
      {
        path: 'secondApproverAbovePaise',
        label: 'Second approver needed above',
        kind: 'money',
      },
    ],
  },
  'refunds.rules': {
    fields: [
      {
        path: 'reasons',
        label: 'Refund reasons',
        kind: 'rows',
        columns: REASON_COLUMNS,
        newRow: { code: '', label: '', bearer: 'PLATFORM' },
        hint: 'Who pays: the vendor (taken from their payout), ZOAURO, or the customer',
      },
      { path: 'autoApprove.enabled', label: 'Approve small refunds automatically', kind: 'bool' },
      { path: 'autoApprove.maxAmountPaise', label: 'Automatic approval up to', kind: 'money' },
      {
        path: 'autoApprove.withinHoursOfDelivery',
        label: 'Within hours of delivery',
        kind: 'int',
      },
      {
        path: 'autoApprove.trusted.minDeliveredOrders',
        label: 'Trusted: at least this many delivered orders',
        kind: 'int',
      },
      {
        path: 'autoApprove.trusted.maxRefundsLast90Days',
        label: 'Trusted: at most this many refunds in 90 days',
        kind: 'int',
      },
      { path: 'decisionTimeLimitMinutes', label: 'Decide a refund within', kind: 'minutes' },
      { path: 'reopenWithinDays', label: 'Customer may reopen within (days)', kind: 'int' },
      {
        path: 'reopenedResolveWorkingDays',
        label: 'Resolve a reopened case within (working days)',
        kind: 'int',
      },
      {
        path: 'targets.ONLINE',
        label: 'Online payments are refunded to',
        kind: 'checks',
        options: REFUND_TARGETS.ONLINE,
      },
      {
        path: 'targets.COD',
        label: 'Cash on delivery is refunded to',
        kind: 'checks',
        options: REFUND_TARGETS.COD,
      },
      {
        path: 'targets.WALLET',
        label: 'Wallet payments are refunded to',
        kind: 'checks',
        options: REFUND_TARGETS.WALLET,
      },
    ],
  },
  'onboarding.documents': {
    fields: [
      docs('RESTAURANT', 'Restaurants'),
      docs('HOMEMAKER', 'Home Food'),
      docs('DELIVERY_PARTNER', 'Delivery partners'),
      docs('HOTEL', 'Hotels', true),
    ],
  },
  'support.sla': {
    fields: [
      { path: 'firstResponseMinutes', label: 'First reply within', kind: 'minutes' },
      { path: 'resolutionMinutes', label: 'Resolve within', kind: 'minutes' },
      { path: 'escalationMinutes', label: 'Escalate after', kind: 'minutes' },
      { path: 'reopenWithinDays', label: 'Reopen within (days)', kind: 'int' },
      { path: 'assignment', label: 'Assignment', kind: 'select', options: SUPPORT_ASSIGNMENT },
    ],
  },
  'notifications.timing': {
    fields: [
      { path: 'promotionalFrom', label: 'Promotions from', kind: 'time' },
      { path: 'promotionalTo', label: 'Promotions until', kind: 'time' },
    ],
  },
  'notifications.channels': {
    fields: [
      { path: 'inApp', label: 'In-app', kind: 'bool' },
      { path: 'email', label: 'Email', kind: 'bool' },
      { path: 'sms', label: 'SMS', kind: 'bool' },
      { path: 'whatsapp', label: 'WhatsApp', kind: 'bool' },
    ],
  },
  'orders.numberFormat': {
    fields: [
      {
        path: 'template',
        label: 'Format',
        kind: 'text',
        hint: 'Placeholders: {ZONE} zone code, {SEQ} number (required once), {YYYY} year, {MM} month',
      },
    ],
  },
  // D190 (2017b87): the reasons an order may be cancelled with, who may use each, and whether it needs a note
  'orders.cancelReasons': {
    fields: [
      {
        path: 'reasons',
        label: 'Cancel reasons',
        kind: 'rows',
        columns: [
          { key: 'code', label: 'Code', kind: 'code' },
          { key: 'label', label: 'Reason', kind: 'text' },
          {
            key: 'usableBy',
            label: 'Who may use it',
            kind: 'checks',
            options: ['ADMIN', 'VENDOR', 'CUSTOMER', 'SYSTEM'],
          },
          { key: 'noteRequired', label: 'Note required', kind: 'bool' },
        ],
        newRow: { code: '', label: '', usableBy: ['ADMIN'], noteRequired: false },
        hint: 'Admins pick from the reasons they may use when they cancel an order',
      },
    ],
  },
  'delivery.maxConcurrentOrders': {
    fields: [
      {
        path: 'perPartner',
        label: 'Orders a partner can carry at once',
        kind: 'int',
        hint: '1 = one order at a time; up to 5',
      },
    ],
  },
  // D173 (50bf799): at or above this much cash in hand a partner takes no new cash-on-delivery orders until settled
  'delivery.codLimitPaise': {
    fields: [
      {
        path: 'limitPaise',
        label: 'Cash a partner may hold',
        kind: 'money',
        hint: 'At or above it: no new cash-on-delivery orders until the cash is handed in',
      },
    ],
  },
  'sms.provider': {
    fields: [
      { path: 'provider', label: 'Provider', kind: 'select', options: SMS_PROVIDER_CHOICES },
      { path: 'senderId', label: 'DLT sender ID', kind: 'text', nullable: true },
      { path: 'dltTemplateIdOtp', label: 'DLT template ID (codes)', kind: 'text', nullable: true },
    ],
  },
  'loyalty.values': {
    nullable: true,
    fields: [
      { path: 'earnRatePercent', label: 'Earn rate (% of order value)', kind: 'number' },
      { path: 'pointsExpiryDays', label: 'Points expire after (days)', kind: 'int' },
      { path: 'pointValuePaise', label: 'Value of one point', kind: 'money' },
      { path: 'minRedeemPoints', label: 'Fewest points a customer can redeem', kind: 'int' },
      {
        path: 'maxRedeemPercentPerOrder',
        label: 'Most of an order paid with points (%)',
        kind: 'int',
      },
      {
        path: 'monthlyEarnCapPoints',
        label: 'Most points earned in a month',
        kind: 'int',
        nullable: true,
        hint: 'Leave empty for no monthly cap',
      },
      {
        path: 'walletConversionEnabled',
        label: 'Customers may convert points to wallet money',
        kind: 'bool',
      },
    ],
  },
  'orders.unpaidTimeoutMinutes': {
    fields: [
      { path: 'ONLINE', label: 'Online payment: cancel when unpaid after', kind: 'minutes' },
      { path: 'WALLET', label: 'Wallet payment: cancel when unpaid after', kind: 'minutes' },
    ],
  },
  'orders.cancellationRules': {
    fields: [
      {
        path: 'CUSTOMER.allowedBefore',
        label: 'A customer may cancel until before',
        kind: 'select',
        options: CANCELLATION_STAGES,
      },
      { path: 'CUSTOMER.reasonRequired', label: 'A customer must give a reason', kind: 'bool' },
      {
        path: 'VENDOR.allowedBefore',
        label: 'A vendor may cancel until before',
        kind: 'select',
        options: CANCELLATION_STAGES,
      },
      { path: 'VENDOR.reasonRequired', label: 'A vendor must give a reason', kind: 'bool' },
      {
        path: 'ADMIN.allowedBefore',
        label: 'An admin may cancel until before',
        kind: 'select',
        options: CANCELLATION_STAGES,
      },
      { path: 'ADMIN.reasonRequired', label: 'An admin must give a reason', kind: 'bool' },
    ],
  },
  'orders.preorder': {
    fields: [
      { path: 'minLeadMinutes', label: 'Placed at least this long ahead', kind: 'minutes' },
      { path: 'maxAheadDays', label: 'Placed at most this many days ahead', kind: 'int' },
      { path: 'travelBufferMinutes', label: 'Travel buffer', kind: 'minutes' },
      {
        path: 'prepMinutes',
        label: 'Preparation time when the vendor has no average',
        kind: 'minutes',
      },
      {
        path: 'cancelCutoffMinutes',
        label: 'Cancel up to this long before dispatch',
        kind: 'minutes',
      },
      {
        path: 'rescheduleCutoffMinutes',
        label: 'Reschedule up to this long before dispatch',
        kind: 'minutes',
      },
      { path: 'maxReschedules', label: 'Most reschedules per pre-order', kind: 'int' },
    ],
  },
  'delivery.autoAssign': {
    fields: [
      { path: 'enabled', label: 'Assign partners automatically', kind: 'bool' },
      { path: 'radiusKm', label: 'Search radius (km)', kind: 'number' },
      { path: 'offerTimeoutSeconds', label: 'Seconds a partner has to accept', kind: 'int' },
    ],
  },
  'payouts.cycleDays': {
    fields: [{ path: 'days', label: 'Payout cycle (days)', kind: 'int', hint: '1 to 31 days' }],
  },
  'zones.deliveryChargeCapPaise': {
    fields: [{ path: 'capPaise', label: 'Most a zone may charge for delivery', kind: 'money' }],
  },
  'access.commissionEditGrantable': {
    fields: [
      {
        path: 'enabled',
        label: 'Commission editing may be granted to Zonal Admins',
        kind: 'bool',
        hint: 'Per member and zone, in the member access editor (D155)',
      },
    ],
  },
  'orders.sla': {
    fields: [
      { path: 'acceptMinutes', label: 'Accept', kind: 'minutes' },
      { path: 'prepareMinutes', label: 'Prepare', kind: 'minutes' },
      { path: 'readyToAssignMinutes', label: 'Ready to partner assigned', kind: 'minutes' },
      { path: 'assignedToPickupMinutes', label: 'Assigned to picked up', kind: 'minutes' },
      { path: 'outForDeliveryMinutes', label: 'Out for delivery to delivered', kind: 'minutes' },
    ],
  },
  'onboarding.ageWarnings': {
    fields: [
      { path: 'warnHours', label: 'Amber after (hours without a decision)', kind: 'int' },
      { path: 'lateHours', label: 'Red after (hours without a decision)', kind: 'int' },
    ],
  },
  'claims.timing': {
    fields: [
      { path: 'ttlMinutes', label: 'A claim lasts without activity (minutes)', kind: 'int' },
      {
        path: 'takeoverTimeoutMinutes',
        label: 'A takeover request waits for the claimer (minutes)',
        kind: 'int',
      },
    ],
  },
  'sessions.remember': {
    fields: [
      { path: 'rememberDays', label: '"Remember me" lasts (days)', kind: 'int' },
      { path: 'rememberIdleHours', label: 'Signed out after idle (hours)', kind: 'int' },
    ],
  },
};

/** One row of a "rows" field: text cells, switches and picked options. */
export type DraftRow = Record<string, string | boolean | string[]>;
/** The form state: text for numbers and strings, booleans, picked options, table rows; null = "not configured". */
export type DraftValue = string | boolean | string[] | DraftRow[] | null;
export interface Draft {
  configured: boolean;
  fields: Record<string, DraftValue>;
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** The value at a dotted path ("a.b.c"), or undefined. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => record(o)[k], obj);
}

/** Sets a dotted path, creating the objects on the way. */
function setPath(out: Record<string, unknown>, path: string, v: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() ?? path;
  let o = out;
  for (const k of keys) {
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[last] = v;
}

export function toDraft(key: string, value: unknown): Draft {
  const spec = KEY_SPECS[key];
  const fields: Record<string, DraftValue> = {};
  for (const f of spec?.fields ?? []) {
    const v = getPath(value, f.path);
    switch (f.kind) {
      case 'money':
        fields[f.path] = typeof v === 'number' ? String(v / 100) : '';
        break;
      case 'minutes':
      case 'int':
      case 'number':
        fields[f.path] = typeof v === 'number' ? String(v) : '';
        break;
      case 'bool':
        fields[f.path] = v === true;
        break;
      case 'lines':
        fields[f.path] = Array.isArray(v) ? v.map(String).join('\n') : '';
        break;
      case 'checks':
        fields[f.path] = Array.isArray(v) ? v.map(String) : [];
        break;
      case 'rows':
        fields[f.path] = Array.isArray(v)
          ? v.map((row) => {
              const r = record(row);
              const out: DraftRow = {};
              for (const c of f.columns ?? [])
                out[c.key] =
                  c.kind === 'bool'
                    ? r[c.key] === true
                    : c.kind === 'checks'
                      ? (Array.isArray(r[c.key]) ? (r[c.key] as unknown[]) : []).map(String)
                      : String(r[c.key] ?? '');
              return out;
            })
          : f.nullable
            ? null
            : [];
        break;
      default:
        fields[f.path] =
          typeof v === 'string' ? v : f.kind === 'select' ? (f.options?.[0] ?? '') : '';
    }
  }
  return { configured: value !== null && value !== undefined, fields };
}

const num = (s: DraftValue): number => (typeof s === 'string' && s.trim() !== '' ? Number(s) : NaN);

export function fromDraft(key: string, draft: Draft): unknown {
  const spec = KEY_SPECS[key];
  if (spec?.nullable && !draft.configured) return null;
  const out: Record<string, unknown> = {};
  for (const f of spec?.fields ?? []) {
    const v = draft.fields[f.path] ?? null;
    switch (f.kind) {
      case 'money':
        setPath(out, f.path, Math.round(num(v) * 100));
        break;
      case 'minutes':
      case 'int':
      case 'number':
        setPath(out, f.path, f.nullable && (v === null || String(v).trim() === '') ? null : num(v));
        break;
      case 'bool':
        setPath(out, f.path, v === true);
        break;
      case 'lines':
        setPath(
          out,
          f.path,
          typeof v === 'string'
            ? v
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
            : [],
        );
        break;
      case 'checks':
        // in the order the options are listed (the first is preferred)
        setPath(
          out,
          f.path,
          Array.isArray(v) ? (f.options ?? []).filter((o) => (v as unknown[]).includes(o)) : [],
        );
        break;
      case 'rows':
        setPath(
          out,
          f.path,
          Array.isArray(v)
            ? (v as DraftRow[]).map((row) => {
                const r: Record<string, unknown> = {};
                for (const c of f.columns ?? []) {
                  const cell = row[c.key];
                  r[c.key] =
                    c.kind === 'bool'
                      ? cell === true
                      : c.kind === 'checks'
                        ? (c.options ?? []).filter((o) => Array.isArray(cell) && cell.includes(o))
                        : c.kind === 'code'
                          ? String(cell ?? '')
                              .trim()
                              .toUpperCase()
                          : String(cell ?? '').trim();
                }
                return r;
              })
            : null,
        );
        break;
      default:
        setPath(
          out,
          f.path,
          f.nullable && (v === null || v === '') ? null : typeof v === 'string' ? v.trim() : v,
        );
    }
  }
  return out;
}

/**
 * Field errors keyed by field path ('' = the value as a whole), from the registry's schema. An issue inside a field
 * (a nested key, or row 3 of a table) is reported on that field; a row's issue names the row.
 */
export function validate(key: string, value: unknown): Record<string, string> {
  const def = settingDef(key);
  if (!def) return { '': 'Unknown setting' };
  const parsed = def.schema.safeParse(value);
  if (parsed.success) return {};
  const paths = (KEY_SPECS[key]?.fields ?? []).map((f) => f.path);
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const segments = issue.path.map(String);
    const joined = segments.join('.');
    const field =
      paths
        .filter((p) => joined === p || joined.startsWith(`${p}.`))
        .sort((a, b) => b.length - a.length)[0] ?? '';
    const rest = field ? segments.slice(field.split('.').length) : [];
    const row =
      rest[0] !== undefined && /^\d+$/.test(rest[0]) ? `Row ${Number(rest[0]) + 1}: ` : '';
    const msg = issue.code === 'invalid_type' ? 'Enter a value' : issue.message;
    if (!errors[field]) errors[field] = `${row}${msg}`;
  }
  return errors;
}

export function formatMinutes(m: number): string {
  if (m % 1440 === 0 && m >= 1440) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0 && m >= 60) return `${m / 60} h`;
  if (m > 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m} min`;
}

function fieldText(f: FieldSpec, v: unknown): string {
  if (v === null || v === undefined) return 'Not configured';
  switch (f.kind) {
    case 'money':
      return typeof v === 'number' ? formatPaise(v) : String(v);
    case 'minutes':
      return typeof v === 'number' ? formatMinutes(v) : String(v);
    case 'bool':
      return v === true ? 'On' : 'Off';
    case 'lines':
      return Array.isArray(v) ? (v.length === 0 ? 'None' : v.join(', ')) : String(v);
    case 'checks':
      return Array.isArray(v)
        ? v.length === 0
          ? 'None'
          : v.map((o) => OPTION_LABEL[String(o)] ?? String(o)).join(', ')
        : String(v);
    case 'rows':
      if (!Array.isArray(v)) return String(v);
      if (v.length === 0) return 'None';
      return v
        .map((row) => {
          const r = record(row);
          const label = String(r['label'] ?? r['code'] ?? '');
          if ('bearer' in r)
            return `${label} (${OPTION_LABEL[String(r['bearer'])] ?? r['bearer']})`;
          if ('mandatory' in r) return r['mandatory'] === false ? `${label} (optional)` : label;
          return label;
        })
        .join(', ');
    case 'select':
      return OPTION_LABEL[String(v)] ?? String(v);
    default:
      return String(v);
  }
}

/** Label/value pairs for a card or a before/after table. */
export function describeValue(key: string, value: unknown): { label: string; text: string }[] {
  const spec = KEY_SPECS[key];
  if (!spec) return [{ label: 'Value', text: JSON.stringify(value) }];
  if (value === null || value === undefined) return [{ label: 'Status', text: 'Not configured' }];
  return spec.fields.map((f) => ({ label: f.label, text: fieldText(f, getPath(value, f.path)) }));
}
