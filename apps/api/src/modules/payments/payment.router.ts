import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/authenticate';
import * as c from './payment.controller';

export const paymentsRouter: Router = Router();
paymentsRouter.use(requireAuth, requireSuperAdmin);
paymentsRouter.get('/', c.listHandler);
