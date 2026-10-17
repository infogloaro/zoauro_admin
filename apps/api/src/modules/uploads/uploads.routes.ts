import { Router, type RequestHandler } from 'express';
import { uploadConfirmSchema, uploadPresignSchema } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import {
  originCheck,
  requireCsrf,
  requireJsonBody,
  requireSession,
} from '../../lib/auth/middleware';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { UploadsService } from './uploads.service';

/**
 * POST /uploads/presign and /uploads/confirm (doc 09: "authenticated"). The object key carries a zone, so the service
 * applies the zone scope of the entity (the vendor) before it signs or confirms anything. Neither writes data: the
 * document is audited when it is attached to the vendor.
 */
export function createUploadsRoutes(service: UploadsService, opts: { appOrigin: string }): Router {
  const router = Router();
  const write: RequestHandler[] = [
    originCheck(opts.appOrigin),
    requireSession(),
    requireCsrf,
    requireJsonBody,
  ];
  router.post(
    '/uploads/presign',
    ...write,
    auditMeta(auditOf('presignUpload')),
    async (req, res) => {
      res.json(await service.presign(authContextOf(res), parseBody(uploadPresignSchema, req.body)));
    },
  );
  router.post(
    '/uploads/confirm',
    ...write,
    auditMeta(auditOf('confirmUpload')),
    async (req, res) => {
      res.json(await service.confirm(authContextOf(res), parseBody(uploadConfirmSchema, req.body)));
    },
  );
  return router;
}
