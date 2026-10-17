import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { errors } from '../../lib/errors';
import * as controller from './uploads.controller';

/**
 * `/uploads/presign` and `/uploads/confirm` (doc 09) are marked
 * "authenticated", but the object key carries a zone, so the zone scope still
 * applies. Until SA-1.7 resolves per-member scope, only a Super Admin can sign
 * or confirm keys — zonal admins get 403 (same seam as `vendor.scope.ts`);
 * when grants land, replace the check with the requested ∩ assigned zones.
 */
function requireUploadScope(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(errors.unauthenticated());
    return;
  }
  if (!req.auth.isSuperAdmin) {
    next(errors.forbidden('Uploads follow the vendor zone scope'));
    return;
  }
  next();
}

export const uploadsRouter: Router = Router();

uploadsRouter.use(requireAuth, requireUploadScope);

uploadsRouter.post('/presign', controller.presignHandler);
uploadsRouter.post('/confirm', controller.confirmHandler);
