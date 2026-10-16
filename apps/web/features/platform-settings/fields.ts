import {
  ONBOARDING_DOCUMENT_TYPES,
  REFUND_COST_BEARERS,
  SMS_PROVIDER_CHOICES,
  SUPPORT_ASSIGNMENT,
  settingDef,
} from '@zoauro/shared';
import { formatPaise } from '../audit/format';

// Platform settings forms (doc 59, D109–D116): one field list per registry key, the conversion between a stored value
// and the form's text fields, client-side validation with the registry's own schema (the server validates again), and
// the one-line summaries the cards show. Pure, so it is tested without a browser.

export type FieldKind =
  'money' | 'minutes' | 'int' | 'number' | 'time' | 'bool' | 'select' | 'text' | 'lines' | 'docs';

export interface FieldSpec {
  path: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
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
  SHARED: 'Shared',
  ROUND_ROBIN: 'Round-robin',
  LEAST_BUSY: 'Least busy',
  MSG91: 'MSG91',
  NONE: 'None',
};

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
    nullable: true,
    fields: [
      { path: 'cancellationWindowMinutes', label: 'Cancellation window', kind: 'minutes' },
      { path: 'reasons', label: 'Refund reasons', kind: 'lines', hint: 'One reason per line' },
      {
        path: 'costBearer',
        label: 'Who bears the cost',
        kind: 'select',
        options: REFUND_COST_BEARERS,
      },
    ],
  },
  'onboarding.documents': {
    fields: [
      { path: 'RESTAURANT', label: 'Restaurants', kind: 'docs' },
      { path: 'DELIVERY_PARTNER', label: 'Delivery partners', kind: 'docs' },
      { path: 'HOME_FOOD', label: 'Home Food', kind: 'docs', nullable: true },
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
    ],
  },
};

/** The form state: text for numbers and strings, booleans, document lists; null = that field is "not configured". */
export type DraftValue = string | boolean | string[] | null;
export interface Draft {
  configured: boolean;
  fields: Record<string, DraftValue>;
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

export function toDraft(key: string, value: unknown): Draft {
  const spec = KEY_SPECS[key];
  const obj = record(value);
  const fields: Record<string, DraftValue> = {};
  for (const f of spec?.fields ?? []) {
    const v = obj[f.path];
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
      case 'docs':
        fields[f.path] = Array.isArray(v) ? v.map(String) : f.nullable ? null : [];
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
        out[f.path] = Math.round(num(v) * 100);
        break;
      case 'minutes':
      case 'int':
      case 'number':
        out[f.path] = num(v);
        break;
      case 'bool':
        out[f.path] = v === true;
        break;
      case 'lines':
        out[f.path] =
          typeof v === 'string'
            ? v
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
            : [];
        break;
      case 'docs':
        out[f.path] = Array.isArray(v) ? v : null;
        break;
      default:
        out[f.path] =
          f.nullable && (v === null || v === '') ? null : typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

/** Field errors keyed by field path ('' = the value as a whole), from the registry's schema. */
export function validate(key: string, value: unknown): Record<string, string> {
  const def = settingDef(key);
  if (!def) return { '': 'Unknown setting' };
  const parsed = def.schema.safeParse(value);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = String(issue.path[0] ?? '');
    const msg = issue.code === 'invalid_type' ? 'Enter a value' : issue.message;
    if (!errors[path]) errors[path] = msg;
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
    case 'docs':
    case 'lines':
      return Array.isArray(v)
        ? v.length === 0
          ? 'None'
          : v
              .map((d) =>
                f.kind === 'docs' ? (DOCUMENT_LABEL[d as keyof typeof DOCUMENT_LABEL] ?? d) : d,
              )
              .join(', ')
        : String(v);
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
  const obj = record(value);
  return spec.fields.map((f) => ({ label: f.label, text: fieldText(f, obj[f.path]) }));
}
