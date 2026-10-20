import { Router } from 'express';
import {
  customerBlockSchema,
  customerCreateSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  customerUnblockSchema,
  customerUpdateSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { CustomersService } from './customers.service';

// /customers (doc 09), mounted at /api/v1. The guard checks the module permission somewhere (403 otherwise); the
// service checks the customer's zones (404 when not visible, D25; 403 when the action is held in none of them).

export function createCustomersRoutes(
  service: CustomersService,
  opts: { appOrigin: string },
): Router {
  const router = Router();
  const write = (action: 'add' | 'edit' | 'status') => [
    originCheck(opts.appOrigin),
    requirePermission('customers', action),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (p: unknown) => parseBody(customerIdParamsSchema, p).id;

  router.get('/customers', requirePermission('customers', 'view'), async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(customerListQuerySchema, req.query)));
  });
  router.post(
    '/customers',
    ...write('add'),
    auditMeta(auditOf('createCustomer')),
    async (req, res) => {
      res
        .status(201)
        .json(await service.create(authContextOf(res), parseBody(customerCreateSchema, req.body)));
    },
  );
  router.get('/customers/:id', requirePermission('customers', 'view'), async (req, res) => {
    res.json(await service.detail(authContextOf(res), id(req.params)));
  });
  router.patch(
    '/customers/:id',
    ...write('edit'),
    auditMeta(auditOf('updateCustomer')),
    async (req, res) => {
      res.json(
        await service.update(
          authContextOf(res),
          id(req.params),
          parseBody(customerUpdateSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/customers/:id/block',
    ...write('status'),
    auditMeta(auditOf('blockCustomer')),
    async (req, res) => {
      res.json(
        await service.block(
          authContextOf(res),
          id(req.params),
          parseBody(customerBlockSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/customers/:id/unblock',
    ...write('status'),
    auditMeta(auditOf('unblockCustomer')),
    async (req, res) => {
      res.json(
        await service.unblock(
          authContextOf(res),
          id(req.params),
          parseBody(customerUnblockSchema, req.body),
        ),
      );
    },
  );
  // D26: doc 09 names a GET; it writes an audit row and is rate-limited
  router.get('/customers/:id/reveal', requirePermission('customers', 'view'), async (req, res) => {
    res.json(await service.reveal(authContextOf(res), id(req.params)));
  });
  return router;
}
