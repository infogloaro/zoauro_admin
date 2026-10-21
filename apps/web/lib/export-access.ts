import type { MeResponse, PermissionModule } from '@zoauro/shared';

/**
 * D149: is the Export button offered on a module's list? A Super Admin always (the API checks the `exports` Control
 * Panel area, D178); a Zonal Admin needs `<module>:export` in a zone whose export switch (limits canExport) is on. A
 * convenience only: the API checks both again for every zone the export covers.
 */
export function canExportList(me: MeResponse, module: PermissionModule): boolean {
  if (me.permissions.global) return true;
  return me.permissions.zones.some(
    (z) => z.permissions.includes(`${module}:export`) && z.limits.canExport,
  );
}
