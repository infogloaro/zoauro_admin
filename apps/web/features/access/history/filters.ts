import { ACCESS_CHANGE_TYPES, type AccessChangeType } from '@zoauro/shared';
import type { DiffChange } from '../../audit/DiffView';
import { zoneIdFromParam } from '../../../lib/zone-scope';

// Access change history filters and display rules (M03, doc 09 GET /access-changes). The URL is the source of truth:
// these pure functions turn the query string into a filter model, the model into API query parameters, and a change's
// before/after snapshots into the field rows of the diff table.

export const HISTORY_PAGE_SIZE = 50;

export const CHANGE_TYPE_LABEL: Record<AccessChangeType, string> = {
  PROFILE_SET: 'Profile set',
  OVERRIDE_SET: 'Override set',
  LIMIT_SET: 'Limit set',
  ZONE_ADDED: 'Zone added',
  ZONE_REMOVED: 'Zone removed',
  PROFILE_EDITED: 'Profile edited',
};

export interface HistoryFilters {
  memberId: string | null;
  zoneId: string | null;
  changeType: AccessChangeType | null;
  /** calendar days (YYYY-MM-DD) in Asia/Kolkata */
  from: string | null;
  to: string | null;
}

export const HISTORY_KEYS = ['member', 'zone', 'type', 'from', 'to'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: string | null): string | null => (v !== null && UUID.test(v) ? v : null);
const date = (v: string | null): string | null => (v !== null && DATE.test(v) ? v : null);

/** `zones` resolves ?zone=<CODE> (the zone switcher's parameter) to the id GET /access-changes filters on. */
export function readHistoryFilters(
  params: URLSearchParams,
  zones: readonly { id: string; code: string }[] = [],
): HistoryFilters {
  const type = params.get('type');
  return {
    memberId: uuid(params.get('member')),
    zoneId: zoneIdFromParam(params.get('zone'), zones),
    changeType: ACCESS_CHANGE_TYPES.find((t) => t === type) ?? null,
    from: date(params.get('from')),
    to: date(params.get('to')),
  };
}

// Asia/Kolkata has no daylight saving: a fixed +05:30 offset is exact (as in the System Logs filters).
const startOfDay = (d: string): string => new Date(`${d}T00:00:00+05:30`).toISOString();
const endOfDay = (d: string): string => new Date(`${d}T23:59:59.999+05:30`).toISOString();

/** Query parameters of GET /access-changes for these filters (no cursor: the hook adds `after`). */
export function toHistoryQuery(f: HistoryFilters) {
  return {
    limit: HISTORY_PAGE_SIZE,
    ...(f.memberId ? { memberId: f.memberId } : {}),
    ...(f.zoneId ? { zoneId: f.zoneId } : {}),
    ...(f.changeType ? { changeType: f.changeType } : {}),
    ...(f.from ? { from: startOfDay(f.from) } : {}),
    ...(f.to ? { to: endOfDay(f.to) } : {}),
  };
}

export const hasHistoryNarrowing = (f: HistoryFilters): boolean =>
  Object.values(f).some((v) => v !== null);

/** "Today", "Yesterday" or "Monday, 12 October" in Asia/Kolkata (like Recent Activities). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  const day = fmt(new Date(iso));
  if (day === fmt(now)) return 'Today';
  if (day === fmt(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An override list reads as "GRANT orders:edit, DENY refunds:add"; any other array stays JSON. */
function arrayText(v: unknown[]): string {
  if (v.length === 0) return 'None';
  const parts = v.map((x) =>
    isPlainObject(x) &&
    typeof x.module === 'string' &&
    typeof x.action === 'string' &&
    typeof x.effect === 'string'
      ? `${x.effect} ${x.module}:${x.action}`
      : typeof x === 'string'
        ? x
        : JSON.stringify(x),
  );
  return parts.join(', ');
}

function flatten(v: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainObject(v)) {
    const entries = Object.entries(v);
    if (entries.length === 0 && prefix) out.set(prefix, null);
    for (const [k, val] of entries) flatten(val, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix || 'value', Array.isArray(v) ? arrayText(v) : v);
}

/** The fields that differ between two snapshots, nested objects as dotted paths, in first-seen order. */
export function toChanges(before: unknown, after: unknown): DiffChange[] {
  const b = new Map<string, unknown>();
  const a = new Map<string, unknown>();
  if (before !== undefined && before !== null) flatten(before, '', b);
  if (after !== undefined && after !== null) flatten(after, '', a);
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  return keys
    .filter((k) => JSON.stringify(b.get(k) ?? null) !== JSON.stringify(a.get(k) ?? null))
    .map((k) => ({ field: k, before: b.get(k), after: a.get(k) }));
}
