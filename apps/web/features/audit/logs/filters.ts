import {
  AUDIT_MODULES,
  ZONE_EXPLICIT_ENTITY_TYPES,
  ZONE_REQUIRED_ENTITY_TYPES,
  type AuditModule,
} from '@zoauro/shared';
import { zoneIdFromParam } from '../../../lib/zone-scope';
import { DEFAULT_TIME_ZONE } from '../format';

// System Logs filters (doc 50 section 9.1). The URL is the source of truth: these functions turn a query string into a
// filter model and the model into API query parameters. Pure, so they are tested without a browser.

export const PAGE_SIZE = 50;
export const DEFAULT_RANGE_DAYS = 7;

export type LogsTab = 'activity' | 'signins';
export const ACTOR_TYPES = ['USER', 'APP_CLIENT', 'SYSTEM', 'WEBHOOK'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const ACTOR_TYPE_LABEL: Record<ActorType, string> = {
  USER: 'Admin',
  APP_CLIENT: 'App',
  SYSTEM: 'System',
  WEBHOOK: 'Webhook',
};

/** Suggestions for the free-text entity type filter: the zone-owned types the audit service knows plus the global ones. */
export const ENTITY_TYPE_SUGGESTIONS: readonly string[] = [
  ...new Set([
    ...ZONE_REQUIRED_ENTITY_TYPES,
    ...ZONE_EXPLICIT_ENTITY_TYPES,
    'api_client',
    'member',
    'session',
    'setting',
    'user',
    'zone',
  ]),
].sort();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- dates (calendar days in the configured timezone, Asia/Kolkata) ---------------------------------------------------

/** Today's calendar date (YYYY-MM-DD) in the panel's timezone. */
export function todayInZone(now: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const to = todayInZone(now);
  return { from: addDays(to, -(DEFAULT_RANGE_DAYS - 1)), to };
}

// Asia/Kolkata has no daylight saving: a fixed +05:30 offset is exact. A different configured zone would need a real
// conversion here.
const startOfDay = (date: string): string => new Date(`${date}T00:00:00+05:30`).toISOString();
const endOfDay = (date: string): string => new Date(`${date}T23:59:59.999+05:30`).toISOString();

/** `?from=` present (even empty) wins; absent means the default. An empty value is "no bound". */
function readDate(params: URLSearchParams, key: 'from' | 'to', fallback: string): string | null {
  if (!params.has(key)) return fallback;
  const v = params.get(key) ?? '';
  if (v === '') return null;
  return DATE.test(v) ? v : fallback;
}

// ---- activity ---------------------------------------------------------------------------------------------------------

export interface ActivityFilters {
  from: string | null;
  to: string | null;
  actorId: string | null;
  /** display name of the chosen actor (cosmetic, kept in the URL so a reload still shows a name) */
  actorName: string | null;
  actorType: ActorType | null;
  module: AuditModule | null;
  action: string | null;
  zoneId: string | null;
  entityType: string | null;
  entityId: string | null;
  q: string | null;
  outcome: 'SUCCESS' | 'DENIED' | null;
  sensitive: boolean;
}

export const ACTIVITY_KEYS = [
  'from',
  'to',
  'actor',
  'actorName',
  'actorType',
  'module',
  'action',
  'zone',
  'entityType',
  'entityId',
  'q',
  'outcome',
  'sensitive',
] as const;

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | null =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const text = (v: string | null, max: number): string | null => {
  const t = v?.trim() ?? '';
  return t === '' ? null : t.slice(0, max);
};
const uuid = (v: string | null): string | null => (v !== null && UUID.test(v) ? v : null);

/** `zones` resolves ?zone=<CODE> (the zone switcher's parameter) to the id GET /audit-logs filters on. */
export function readActivityFilters(
  params: URLSearchParams,
  now: Date = new Date(),
  zones: readonly { id: string; code: string }[] = [],
): ActivityFilters {
  const range = defaultRange(now);
  return {
    from: readDate(params, 'from', range.from),
    to: readDate(params, 'to', range.to),
    actorId: uuid(params.get('actor')),
    actorName: text(params.get('actorName'), 100),
    actorType: pick(params.get('actorType'), ACTOR_TYPES),
    module: pick(params.get('module'), AUDIT_MODULES),
    action: text(params.get('action'), 80),
    zoneId: zoneIdFromParam(params.get('zone'), zones),
    entityType: text(params.get('entityType'), 60),
    entityId: uuid(params.get('entityId')),
    q: text(params.get('q'), 100),
    outcome: pick(params.get('outcome'), ['SUCCESS', 'DENIED'] as const),
    sensitive: params.get('sensitive') === '1',
  };
}

/** Query string parameters of GET /audit-logs for these filters (no cursor: the hook adds `after`). */
export function toActivityQuery(f: ActivityFilters) {
  return {
    limit: PAGE_SIZE,
    ...(f.from ? { from: startOfDay(f.from) } : {}),
    ...(f.to ? { to: endOfDay(f.to) } : {}),
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.actorType ? { actorType: f.actorType } : {}),
    ...(f.module ? { module: f.module } : {}),
    ...(f.action ? { action: f.action } : {}),
    ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.outcome ? { outcome: f.outcome } : {}),
    ...(f.sensitive ? { sensitivity: 'HIGH' as const } : {}),
  };
}

/** Anything beyond the default date range narrows the list (drives the empty state's wording). */
export function hasActivityNarrowing(f: ActivityFilters, now: Date = new Date()): boolean {
  const range = defaultRange(now);
  return (
    f.from !== range.from ||
    f.to !== range.to ||
    [
      f.actorId,
      f.actorType,
      f.module,
      f.action,
      f.zoneId,
      f.entityType,
      f.entityId,
      f.q,
      f.outcome,
    ].some((v) => v !== null) ||
    f.sensitive
  );
}

// ---- sign-ins ---------------------------------------------------------------------------------------------------------

export interface SignInFilters {
  from: string | null;
  to: string | null;
  userId: string | null;
  userName: string | null;
  success: 'true' | 'false' | null;
}

export const SIGNIN_KEYS = ['from', 'to', 'user', 'userName', 'success'] as const;

export function readSignInFilters(params: URLSearchParams, now: Date = new Date()): SignInFilters {
  const range = defaultRange(now);
  return {
    from: readDate(params, 'from', range.from),
    to: readDate(params, 'to', range.to),
    userId: uuid(params.get('user')),
    userName: text(params.get('userName'), 100),
    success: pick(params.get('success'), ['true', 'false'] as const),
  };
}

export function hasSignInNarrowing(f: SignInFilters, now: Date = new Date()): boolean {
  const range = defaultRange(now);
  return f.from !== range.from || f.to !== range.to || f.userId !== null || f.success !== null;
}

export function toSignInQuery(f: SignInFilters) {
  return {
    limit: PAGE_SIZE,
    ...(f.from ? { from: startOfDay(f.from) } : {}),
    ...(f.to ? { to: endOfDay(f.to) } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.success ? { success: f.success } : {}),
  };
}

export function readTab(params: URLSearchParams): LogsTab {
  return params.get('tab') === 'signins' ? 'signins' : 'activity';
}
