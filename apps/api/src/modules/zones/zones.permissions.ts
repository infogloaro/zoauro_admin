/**
 * Permission keys for Zone Management (doc 04: Super Admin V A E D — never
 * grantable to Zonal Admin). Guards are role-based in SA-1.1; the keys are
 * declared so SA-1.7's access model can adopt them without route changes.
 */
export const ZONE_PERMISSIONS = {
  view: 'zones:view',
  add: 'zones:add',
  edit: 'zones:edit',
  delete: 'zones:delete',
} as const;

export type ZonePermission = (typeof ZONE_PERMISSIONS)[keyof typeof ZONE_PERMISSIONS];
