import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { OrderService } from './service';
import { createOrderController } from './controller';

export const createOrderRoutes = (service: OrderService, authenticate: RequestHandler) => {
  const router = Router();
  const controller = createOrderController(service);

  router.use(authenticate);

  router.get('/dashboard', controller.dashboard);
  router.get('/', controller.list);
  router.post('/:id/transition', controller.transition);

  return router;
};
