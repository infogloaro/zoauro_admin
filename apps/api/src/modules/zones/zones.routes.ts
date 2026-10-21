import { Router, type RequestHandler } from 'express';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { requirePermission } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { createZonesController } from './zones.controller';

type Controller = ReturnType<typeof createZonesController>;

/**
 * Mounted at /api/v1 (doc 53 section 5). Every route needs a `zones:*` (or `access:view`) permission, which is never
 * grantable to a Zonal Admin: only a Super Admin passes (R-ZONE-1), everyone else gets 403. Mutations: Origin check,
 * session CSRF, JSON body; status changes and delete also need a PASSWORD re-authentication (doc 53 section 2.1).
 * Fixed paths (/zones/summary, /zones/lookup) come before /zones/:id.
 */
export function createZonesRoutes(
  c: Controller,
  opts: {
    appOrigin: string;
    requireReauth: (level: ReauthLevel) => RequestHandler;
    /** D178: the Control Panel area guard (absent: no area check, tests) */
    requireArea?: (area: (req: Parameters<RequestHandler>[0]) => string | null) => RequestHandler;
  },
): Router {
  const router = Router();
  // D178: zone writes need the `zones` area; a zone's team belongs to `access`, its settings to `settings.<group>`
  // (both guarded by their own routers); reads stay open to every Super Admin (pickers in other areas)
  if (opts.requireArea)
    router.use(
      opts.requireArea((req) =>
        req.method === 'GET' ||
        !req.path.startsWith('/zones') ||
        /^\/zones\/[^/]+\/(settings|team)(\/|$)/.test(req.path)
          ? null
          : 'zones',
      ),
    );
  const write = (action: 'add' | 'edit' | 'status' | 'delete') => [
    originCheck(opts.appOrigin),
    requirePermission('zones', action),
    requireCsrf,
  ];

  router.get('/zones', requirePermission('zones', 'view'), c.list);
  router.get('/zones/summary', requirePermission('zones', 'view'), c.summary);
  router.get('/zones/lookup', requirePermission('zones', 'view'), c.lookup);
  router.post(
    '/zones',
    ...write('add'),
    requireJsonBody,
    auditMeta(auditOf('createZone')),
    c.create,
  );
  router.get('/zones/:id', requirePermission('zones', 'view'), c.detail);
  router.patch(
    '/zones/:id',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('updateZone')),
    c.patch,
  );
  router.delete(
    '/zones/:id',
    ...write('delete'),
    opts.requireReauth('PASSWORD'),
    auditMeta(auditOf('deleteZone')),
    c.remove,
  );
  router.put(
    '/zones/:id/pincodes',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('updateZonePincodes')),
    c.pincodes,
  );
  router.post(
    '/zones/:id/activate',
    ...write('status'),
    opts.requireReauth('PASSWORD'),
    requireJsonBody,
    auditMeta(auditOf('activateZone')),
    c.activate,
  );
  router.get('/zones/:id/impact', requirePermission('zones', 'view'), c.impact);
  router.post(
    '/zones/:id/deactivate',
    ...write('status'),
    opts.requireReauth('PASSWORD'),
    requireJsonBody,
    auditMeta(auditOf('deactivateZone')),
    c.deactivate,
  );
  // D92 service switches: a Super Admin only; switching off stops new business for the service in the zone (PASSWORD)
  router.get('/zones/:id/services', requirePermission('zones', 'view'), c.services);
  router.put(
    '/zones/:id/services',
    ...write('edit'),
    opts.requireReauth('PASSWORD'),
    requireJsonBody,
    auditMeta(auditOf('putZoneServices')),
    c.putServices,
  );
  // read side of M03 (doc 53 section 5): access:view, also never grantable
  router.get('/zones/:id/team', requirePermission('access', 'view'), c.team);
  return router;
}
