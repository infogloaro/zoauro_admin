import { z } from 'zod';
import {
  controlAreaCatalogueResponseSchema,
  controlAreasSchema,
  putSuperAdminAreasSchema,
  setSuperAdminPrimarySchema,
  superAdminIdParamsSchema,
  superAdminSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// D178 (owner's final design): primaries hold every Control Panel area and alone manage Super Admins; a non-primary
// Super Admin holds only its granted areas. Writes: primary only (403 PRIMARY_ONLY), STRONG re-authentication.

export const CONTROL_AREA_OPERATIONS: OperationDef[] = [
  {
    operationId: 'myControlAreas',
    method: 'get',
    path: '/me/control-areas',
    tags: ['access'],
    summary:
      'The caller’s Control Panel areas: {isPrimary, areas[]} for a Super Admin (every key for a primary), null for a Zonal Admin',
    access: { kind: 'session' },
    response: {
      status: 200,
      schema: z.object({ controlAreas: controlAreasSchema.nullable() }),
      description: 'My areas',
    },
  },
  {
    operationId: 'listControlAreas',
    method: 'get',
    path: '/super-admins/areas',
    tags: ['access'],
    summary:
      'The Control Panel areas a primary can grant, in display order (zones, access, exports, audit, settings.<group>)',
    access: { kind: 'permission', permission: 'admins:view', zone: 'none' },
    response: { status: 200, schema: controlAreaCatalogueResponseSchema, description: 'Areas' },
  },
  {
    operationId: 'putSuperAdminAreas',
    method: 'put',
    path: '/super-admins/{id}/areas',
    tags: ['access'],
    summary:
      'Primary only (STRONG): the complete set of a non-primary Super Admin’s areas, with a reason; audited; the member and the actor are emailed. A primary holds every area (422 PRIMARY_HOLDS_ALL)',
    access: { kind: 'permission', permission: 'admins:edit', zone: 'none', reauth: 'STRONG' },
    audit: { module: 'admins', action: 'member.updated' },
    params: superAdminIdParamsSchema,
    body: putSuperAdminAreasSchema,
    response: { status: 200, schema: superAdminSchema, description: 'Saved' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'setSuperAdminPrimary',
    method: 'post',
    path: '/super-admins/{id}/primary',
    tags: ['access'],
    summary:
      'Primary only (STRONG): promote or demote a Super Admin, with a reason; the last active primary cannot be demoted (409 LAST_PRIMARY)',
    access: { kind: 'permission', permission: 'admins:edit', zone: 'none', reauth: 'STRONG' },
    audit: { module: 'admins', action: 'member.updated' },
    params: superAdminIdParamsSchema,
    body: setSuperAdminPrimarySchema,
    response: { status: 200, schema: superAdminSchema, description: 'Saved' },
    errors: ['NOT_FOUND', 'CONFLICT'],
  },
];
