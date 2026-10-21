import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { customerHandlers } from './customer.controller';
import { requireCustomerPermission } from './customer.scope';

/**
 * M09 Customers endpoints (doc 09 `/customers`, doc 34 SA-3.1):
 *   GET    /customers                    customers:view    list + counts/facets (D25 scope)
 *   POST   /customers                    customers:add     source=ADMIN server-side (D28)
 *   GET    /customers/{id}               customers:view    masked profile + addresses (D26)
 *   PATCH  /customers/{id}               customers:edit    name/email/status only
 *   POST   /customers/{id}/block         customers:status  no body, audited
 *   POST   /customers/{id}/unblock       customers:status  no body, audited
 *   GET    /customers/{id}/reveal        customers:reveal  audited unmask (D26)
 * Doc 09 lists no DELETE /customers — no delete route is offered.
 */
export function createCustomersRouter(): Router {
  const router: Router = Router();
  const h = customerHandlers;

  router.use(requireAuth, requireCustomerPermission('view'));

  router.get('/', h.list);
  router.post('/', requireCustomerPermission('add'), h.create);
  router.get('/:id', h.get);
  router.patch('/:id', requireCustomerPermission('edit'), h.patch);
  router.post('/:id/block', requireCustomerPermission('status'), h.block);
  router.post('/:id/unblock', requireCustomerPermission('status'), h.unblock);
  router.get('/:id/reveal', requireCustomerPermission('reveal'), h.reveal);

  return router;
}
