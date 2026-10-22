import type { ShellRole } from './navigation';

// Zone scope switcher (M05, owner's spec 2.11, D116): the selected zone travels in the URL as ?zone=<ZONE CODE> so a
// view can be shared and refreshed; "all zones" is no parameter. It is a view filter only: the API scopes every request
// to the member's zones whatever the URL says (an unassigned zone is 404), so nothing here is a security boundary.

export interface ScopeZone {
  id: string;
  name: string;
  code: string;
  colorHex: string;
}

export const ZONE_PARAM = 'zone';

/** The zone a ?zone=<CODE> names among the zones this person may choose; null = all (or a code they may not use). */
const ZONE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ?zone=<CODE> (M05) as a zone id, for a page whose API filter takes the id: by code in `zones`, or the id itself from
 * an older link. null when absent, or when the code is not (yet) known.
 */
export function zoneIdFromParam(
  raw: string | null,
  zones: readonly { id: string; code: string }[],
): string | null {
  if (!raw) return null;
  if (ZONE_ID.test(raw)) return raw;
  const c = raw.trim().toUpperCase();
  return zones.find((z) => z.code.toUpperCase() === c)?.id ?? null;
}

export function selectedZone(code: string | null, zones: readonly ScopeZone[]): ScopeZone | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  return zones.find((z) => z.code.toUpperCase() === c) ?? null;
}

export function allLabel(role: ShellRole): string {
  return role === 'SUPER_ADMIN' ? 'All zones' : 'All my zones';
}

/** What the switcher button says. */
export function scopeLabel(
  role: ShellRole,
  selected: ScopeZone | null,
  zones: readonly ScopeZone[],
): string {
  if (selected) return selected.name;
  if (role === 'ZONAL_ADMIN') {
    if (zones.length === 0) return 'No zones';
    if (zones.length === 1) return zones[0]?.name ?? '';
  }
  return allLabel(role);
}

/** A Zonal Admin with one zone (or none) has nothing to switch (doc 18 §4: static). */
export function canSwitch(role: ShellRole, zones: readonly ScopeZone[]): boolean {
  return role === 'SUPER_ADMIN' || zones.length > 1;
}

/** The query string with ?zone set to a code, or removed for "all". */
export function withZone(search: string, code: string | null): string {
  const params = new URLSearchParams(search);
  if (code) params.set(ZONE_PARAM, code);
  else params.delete(ZONE_PARAM);
  return params.toString();
}
