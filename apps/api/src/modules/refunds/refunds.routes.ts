import { Router, type RequestHandler } from 'express';
import {
  orderIdParamsSchema,
  refundApproveSchema,
  refundCreateSchema,
  refundDecideSchema,
  refundIdParamsSchema,
  refundListQuerySchema,
  refundRecordPaymentSchema,
  refundRejectSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { RefundsService } from './refunds.service';

// Refunds (doc 09, D180, D187), mounted at /api/v1. refunds:add (grantable, "create within limits") requests, decides
// and retries in the order's zone; refunds:edit is never grantable, so approve, reject and record-payment are Super
// Admin only (doc 09 names it refunds:approve, doc 32); approve and reject need a PASSWORD re-authentication (doc 16).

export function createRefundsRoutes(
  service: RefundsService,
  opts: {
    appOrigin: string;
    requireReauth: (level: ReauthLevel) => RequestHandler;
    idempotency: RequestHandler;
  },
): Router {
  const router = Router();
  const id = (p: unknown) => parseBody(refundIdParamsSchema, p).id;
  const write = (action: 'add' | 'edit') => [
    originCheck(opts.appOrigin),
    requirePermission('refunds', action),
    requireCsrf,
  ];

  router.post(
    '/orders/:id/refunds',
    ...write('add'),
    requireJsonBody,
    // before the idempotency replay, so a replayed answer carries the route's audit metadata too
    auditMeta(auditOf('createRefund')),
    opts.idempotency,
    async (req, res) => {
      const orderId = parseBody(orderIdParamsSchema, req.params).id;
      res
        .status(201)
        .json(
          await service.create(
            authContextOf(res),
            orderId,
            parseBody(refundCreateSchema, req.body),
            req.get('idempotency-key') ?? '',
          ),
        );
    },
  );
  router.get('/refunds', requirePermission('refunds', 'view'), async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(refundListQuerySchema, req.query)));
  });
  router.get('/refunds/:id', requirePermission('refunds', 'view'), async (req, res) => {
    res.json(await service.detail(authContextOf(res), id(req.params)));
  });
  router.post(
    '/refunds/:id/decide',
    ...write('add'),
    requireJsonBody,
    auditMeta(auditOf('decideRefund')),
    async (req, res) => {
      res.json(
        await service.decide(
          authContextOf(res),
          id(req.params),
          parseBody(refundDecideSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/refunds/:id/approve',
    ...write('edit'),
    opts.requireReauth('PASSWORD'),
    requireJsonBody,
    auditMeta(auditOf('approveRefund')),
    async (req, res) => {
      res.json(
        await service.approve(
          authContextOf(res),
          id(req.params),
          parseBody(refundApproveSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/refunds/:id/reject',
    ...write('edit'),
    opts.requireReauth('PASSWORD'),
    requireJsonBody,
    auditMeta(auditOf('rejectRefund')),
    async (req, res) => {
      res.json(
        await service.reject(
          authContextOf(res),
          id(req.params),
          parseBody(refundRejectSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/refunds/:id/record-payment',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('recordRefundPayment')),
    async (req, res) => {
      res.json(
        await service.recordPayment(
          authContextOf(res),
          id(req.params),
          parseBody(refundRecordPaymentSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/refunds/:id/retry',
    ...write('add'),
    auditMeta(auditOf('retryRefund')),
    async (req, res) => {
      res.json(await service.retry(authContextOf(res), id(req.params)));
    },
  );
  return router;
}
