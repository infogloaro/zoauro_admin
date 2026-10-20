import type { RequestHandler, Router } from 'express';
import {
  createSuperAdminSchema,
  deleteSuperAdminSchema,
  superAdminIdParamsSchema,
  superAdminStatusSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { SuperAdminsService } from './super-admins.service';

/**
 * Super Admins (D148). admins:* is never grantable, so only a Super Admin passes (a Zonal Admin gets 403). Every write:
 * Origin, session CSRF, JSON body and STRONG re-authentication (password and a 2-step code).
 */
export function registerSuperAdminsRoutes(
  router: Router,
  service: SuperAdminsService,
  opts: { appOrigin: string; requireReauth: (level: ReauthLevel) => RequestHandler },
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
