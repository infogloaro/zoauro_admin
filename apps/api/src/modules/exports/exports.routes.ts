import { Router, type RequestHandler } from 'express';
import { EXPORT_LIST_PATHS, exportIdParamsSchema, type ExportModule } from '@zoauro/shared';
import { requireSession } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { rawQueryOf } from '../../lib/exports';
import type { ExportsService } from './exports.service';

/**
 * Mounted at /api/v1 BEFORE the list modules' routers, so `<list>/export` is never read as `<list>/{id}` (doc 09).
 * GET <list>/export (D149): <module>:export somewhere, then the service takes the list's zone scope and needs
 * <module>:export plus the zone's export switch in every exported zone; 202 with the job.
 * GET /exports/{id}: any session; only the requester's own job is found (doc 09 "requester").
 */
export function createExportsRoutes(
  service: ExportsService,
  modules: readonly ExportModule[],
): Router {
  const router = Router();

  for (const module of modules) {
    const path = EXPORT_LIST_PATHS[module];
    if (path === null) continue;
    const start: RequestHandler = async (req, res) => {
      res
        .status(202)
        .json(await service.request(authContextOf(res), module, rawQueryOf(req.query)));
    };
    router.get(`${path}/export`, requirePermission(module, 'export'), start);
  }

  const getExport: RequestHandler = async (req, res) => {
    res.json(await service.get(authContextOf(res), parseBody(exportIdParamsSchema, req.params).id));
  };
  router.get('/exports/:id', requireSession(), getExport);
  return router;
}
