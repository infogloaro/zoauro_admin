import {
  ACCESS_LIMIT_MAX_PAISE,
  paiseToRupees,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  rupeesToPaise,
  type MemberAccess,
  type MemberAssignment,
  type OverrideEffect,
  type PermissionKey,
  type PutMemberAccessInput,
} from '@zoauro/shared';
import { fieldLabel, formatPaise } from '../../audit/format';
import { isApiError, TRY_AGAIN } from '../../auth/errors';

// The editable copy of a member's access (D104–D108) and the pure rules around it: building the PUT body (rupees typed
// by the Super Admin become integer paise; empty = null = the profile default), the override cycle, dirty tracking and
// mapping the API's errors back to the right zone card.

export type Tri = 'default' | 'yes' | 'no';

export interface ZoneRef {
  id: string;
  name: string;
  code: string;
  colorHex: string;
  status: MemberAssignment['zone']['status'];
}

export interface DraftAssignment {
  zone: ZoneRef;
  profileId: string;
  overrides: Partial<Record<PermissionKey, OverrideEffect>>;
  /** rupees as typed; '' = use the profile default */
  perRefund: string;
  dailyRefund: string;
  canReveal: Tri;
  canExport: Tri;
  note: string;
  /** the saved assignment (effective limits as hints); null for a zone added in this edit */
  saved: MemberAssignment | null;
}

const triOf = (v: boolean | null): Tri => (v === null ? 'default' : v ? 'yes' : 'no');
const boolOf = (t: Tri): boolean | null => (t === 'default' ? null : t === 'yes');
const rupeesText = (p: number | null): string => (p === null ? '' : String(paiseToRupees(p)));

export function toDraft(a: MemberAssignment): DraftAssignment {
  const overrides: DraftAssignment['overrides'] = {};
  for (const o of a.overrides) overrides[`${o.module}:${o.action}`] = o.effect;
  return {
    zone: a.zone,
    profileId: a.profile.id,
    overrides,
    perRefund: rupeesText(a.limits.perRefund),
    dailyRefund: rupeesText(a.limits.dailyRefund),
    canReveal: triOf(a.limits.canReveal),
    canExport: triOf(a.limits.canExport),
    note: a.note ?? '',
    saved: a,
  };
}

export function newDraft(zone: ZoneRef, profileId: string): DraftAssignment {
  return {
    zone,
    profileId,
    overrides: {},
    perRefund: '',
    dailyRefund: '',
    canReveal: 'default',
    canExport: 'default',
    note: '',
    saved: null,
  };
}

/** A cell cycles Profile → Grant → Deny → Profile. */
export function nextEffect(current: OverrideEffect | undefined): OverrideEffect | undefined {
  if (current === undefined) return 'GRANT';
  if (current === 'GRANT') return 'DENY';
  return undefined;
}

/** '' -> null (profile default); '1500.5' -> 150050 paise; anything else is an error message. */
export function parseLimit(text: string): { paise: number | null } | { error: string } {
  const t = text.trim();
  if (t === '') return { paise: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Enter rupees, at most 2 decimals' };
  const paise = rupeesToPaise(Number(t));
  if (paise > ACCESS_LIMIT_MAX_PAISE)
    return { error: `At most ${formatPaise(ACCESS_LIMIT_MAX_PAISE)}` };
  return { paise };
}

function overrideList(d: DraftAssignment) {
  const out: PutMemberAccessInput['assignments'][number]['overrides'] = [];
  for (const m of PERMISSION_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      const effect = d.overrides[`${m}:${action}`];
      if (effect) out.push({ module: m, action, effect });
    }
  }
  return out;
}

/** The PUT body, or the client-side errors per zone id when a limit is not valid. */
export function buildBody(
  drafts: DraftAssignment[],
  version: string,
): { body: PutMemberAccessInput } | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const assignments: PutMemberAccessInput['assignments'] = [];
  for (const d of drafts) {
    const per = parseLimit(d.perRefund);
    const day = parseLimit(d.dailyRefund);
    if ('error' in per || 'error' in day) {
      errors[d.zone.id] = [
        ...('error' in per ? [`Per refund: ${per.error}`] : []),
        ...('error' in day ? [`Per day: ${day.error}`] : []),
      ];
      continue;
    }
    assignments.push({
      zoneId: d.zone.id,
      profileId: d.profileId,
      overrides: overrideList(d),
      limits: {
        perRefund: per.paise,
        dailyRefund: day.paise,
        canReveal: boolOf(d.canReveal),
        canExport: boolOf(d.canExport),
      },
      note: d.note.trim() === '' ? null : d.note.trim(),
    });
  }
  return Object.keys(errors).length > 0 ? { errors } : { body: { assignments, version } };
}

/** A comparable form of the drafts: equal strings = nothing to save. */
export const snapshot = (drafts: DraftAssignment[]): string =>
  JSON.stringify(
    drafts.map((d) => [
      d.zone.id,
      d.profileId,
      overrideList(d),
      d.perRefund.trim(),
      d.dailyRefund.trim(),
      d.canReveal,
      d.canExport,
      d.note.trim(),
    ]),
  );

export const draftsOf = (access: MemberAccess): DraftAssignment[] =>
  access.assignments.map(toDraft);

export interface SaveErrors {
  general: string | null;
  byZone: Record<string, string[]>;
  /** 409 STALE_VERSION: only a reload helps */
  stale: boolean;
}

export const NO_ERRORS: SaveErrors = { general: null, byZone: {}, stale: false };

/** "overrides.2" -> "Override orders edit" (the order sent), "limits.perRefund" -> "Limits › Per refund". */
function pathLabel(path: string, d: DraftAssignment): string {
  const o = /^overrides\.(\d+)/.exec(path);
  const sent = o ? overrideList(d)[Number(o[1])] : undefined;
  return sent ? `Override ${sent.module} ${sent.action}` : fieldLabel(path);
}

/**
 * The API's refusal. VALIDATION_ERROR field paths (assignments.<i>.…, also the 422 for a never-grantable GRANT) go to
 * the card of the zone sent at that index; the rest is one message above the cards.
 */
export function saveErrors(err: unknown, sent: DraftAssignment[]): SaveErrors {
  if (!isApiError(err)) return { ...NO_ERRORS, general: TRY_AGAIN };
  const byZone: Record<string, string[]> = {};
  const loose: string[] = [];
  for (const det of err.details) {
    const m = /^assignments\.(\d+)\.?(.*)$/.exec(det.field);
    const d = m ? sent[Number(m[1])] : undefined;
    if (m && d)
      (byZone[d.zone.id] ??= []).push(m[2] ? `${pathLabel(m[2], d)}: ${det.issue}` : det.issue);
    else loose.push(det.field ? `${fieldLabel(det.field)}: ${det.issue}` : det.issue);
  }
  const placed = Object.keys(byZone).length > 0;
  const result = (general: string, stale = false): SaveErrors => ({ general, byZone, stale });
  switch (err.code) {
    case 'STALE_VERSION':
      return result("Someone changed this member's access since you opened it; reload.", true);
    case 'ZONE_NOT_FOUND':
      return result(
        'A zone is no longer available (deleted, or not Active or Upcoming). Remove it and save again.',
      );
    case 'NOT_FOUND':
      return result('This member no longer exists.');
    case 'VALIDATION_ERROR':
      return result(
        loose.length > 0
          ? loose.join('; ')
          : placed
            ? 'Some zones need attention: see the cards marked in red.'
            : err.message || TRY_AGAIN,
      );
    default:
      return result(err.message || TRY_AGAIN);
  }
}
