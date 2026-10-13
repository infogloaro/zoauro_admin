import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth, requireRecentReauth, requireSuperAdmin } from '../../middleware/authenticate';
import * as controller from './zones.controller';

export const zonesRouter: Router = Router();

/**
 * Zone Management is Super Admin only (doc 04 "not grantable", doc 09 zones:*).
 * Deactivation — DELETE or PATCH to INACTIVE — additionally needs a password
 * confirmation within 10 minutes (doc 14 §4).
 */
zonesRouter.use(requireAuth, requireSuperAdmin);

function reauthIfDeactivating(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'PATCH' && req.body?.status === 'INACTIVE') {
    requireRecentReauth(req, res, next);
    return;
  }
  next();
}

zonesRouter.get('/', controller.listHandler);
zonesRouter.post('/', controller.createHandler);
zonesRouter.get('/:id', controller.getHandler);
zonesRouter.get('/:id/impact', controller.impactHandler);
zonesRouter.patch('/:id', reauthIfDeactivating, controller.updateHandler);
zonesRouter.delete('/:id', requireRecentReauth, controller.removeHandler);
