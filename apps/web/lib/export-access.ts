import type { MeResponse, PermissionModule } from '@zoauro/shared';

/** D178: may this Super Admin start exports? A primary always; a non-primary only with the `exports` area. */
export const superAdminExports = (me: MeResponse): boolean =>
  !me.controlAreas || me.controlAreas.isPrimary || me.controlAreas.areas.includes('exports');

/**
 * D149: is the Export button offered on a module's list? A Super Admin per superAdminExports (the API refuses an
 * ungranted area anyway); a Zonal Admin needs `<module>:export` in a zone whose export switch (limits canExport) is
 * on. A convenience only: the API checks both again for every zone the export covers.
 */
export function canExportList(me: MeResponse, module: PermissionModule): boolean {
  if (me.permissions.global) return superAdminExports(me);
  return me.permissions.zones.some(
    (z) => z.permissions.includes(`${module}:export`) && z.limits.canExport,
  );
}
