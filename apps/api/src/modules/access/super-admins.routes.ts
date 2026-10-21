import type { RequestHandler, Router } from 'express';
import {
  CONTROL_AREAS,
  createSuperAdminSchema,
  deleteSuperAdminSchema,
  putSuperAdminAreasSchema,
  setSuperAdminPrimarySchema,
  superAdminIdParamsSchema,
  superAdminStatusSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import {
  getAuth,
  originCheck,
  requireCsrf,
  requireJsonBody,
  requireSession,
} from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { ControlAreasService } from './control-areas';
import type { SuperAdminsService } from './super-admins.service';

/**
 * Super Admins (D148, D178). admins:* is never grantable, so only a Super Admin passes (a Zonal Admin gets 403); the
 * service lets only a primary write (403 PRIMARY_ONLY). Every write: Origin, session CSRF, JSON body and STRONG
 * re-authentication (password and a 2-step code). GET /me/control-areas: the caller's own areas (null for a Zonal Admin).
 */
export function registerSuperAdminsRoutes(
  router: Router,
  service: SuperAdminsService,
  opts: {
    appOrigin: string;
    requireReauth: (level: ReauthLevel) => RequestHandler;
    areas: ControlAreasService;
  },
): Router {
  const strong = opts.requireReauth('STRONG');
  const write = (action: 'add' | 'edit' | 'delete') => [
    originCheck(opts.appOrigin),
    requirePermission('admins', action),
    requireCsrf,
    requireJsonBody,
    strong,
  ];
  const id = (params: unknown) => parseBody(superAdminIdParamsSchema, params).id;

  router.get('/me/control-areas', requireSession(), async (_req, res) => {
    const auth = getAuth(res);
    res.json({ controlAreas: auth ? await opts.areas.of(auth.userId) : null });
  });
  router.get('/super-admins/areas', requirePermission('admins', 'view'), (_req, res) => {
    res.json({ data: CONTROL_AREAS });
  });
  router.get('/super-admins', requirePermission('admins', 'view'), async (_req, res) => {
    res.json(await service.list(authContextOf(res)));
  });
  router.post(
    '/super-admins',
    ...write('add'),
    auditMeta(auditOf('createSuperAdmin')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await service.create(authContextOf(res), parseBody(createSuperAdminSchema, req.body)),
        );
    },
  );
  router.patch(
    '/super-admins/:id/status',
    ...write('edit'),
    auditMeta(auditOf('setSuperAdminStatus')),
    async (req, res) => {
      res.json(
        await service.setStatus(
          authContextOf(res),
          id(req.params),
          parseBody(superAdminStatusSchema, req.body),
        ),
      );
    },
  );
  router.put(
    '/super-admins/:id/areas',
    ...write('edit'),
    auditMeta(auditOf('putSuperAdminAreas')),
    async (req, res) => {
      res.json(
        await service.setAreas(
          authContextOf(res),
          id(req.params),
          parseBody(putSuperAdminAreasSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/super-admins/:id/primary',
    ...write('edit'),
    auditMeta(auditOf('setSuperAdminPrimary')),
    async (req, res) => {
      res.json(
        await service.setPrimary(
          authContextOf(res),
          id(req.params),
          parseBody(setSuperAdminPrimarySchema, req.body),
        ),
      );
    },
  );
  router.delete(
    '/super-admins/:id',
    ...write('delete'),
    auditMeta(auditOf('deleteSuperAdmin')),
    async (req, res) => {
      const { reason } = parseBody(deleteSuperAdminSchema, req.body);
      await service.remove(authContextOf(res), id(req.params), reason);
      res.status(204).end();
    },
  );
  return router;
}
