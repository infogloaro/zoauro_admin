import { Router, type Request, type RequestHandler } from 'express';
import {
  assignTicketSchema,
  createTicketSchema,
  orderIfMatchSchema,
  ticketIdParamsSchema,
  ticketListQuerySchema,
  ticketMessageSchema,
  transitionTicketSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { SupportService } from './support.service';

/** `If-Match: <version>` (doc 09 convention, as for orders): required on transition and assign. */
function versionOf(req: Request): number {
  const parsed = orderIfMatchSchema.safeParse(req.get('If-Match'));
  if (parsed.success) return parsed.data;
  throw new AppError('VALIDATION_ERROR', 'Send the ticket version in the If-Match header', [
    { field: 'If-Match', issue: req.get('If-Match') === undefined ? 'required' : 'invalid' },
  ]);
}

/**
 * Mounted at /api/v1 (doc 09 "Support", D139-D141). Reads: support:view, bounded by its zones. Writes: support:edit on
 * the ticket's zone (the service: 404 outside view scope, 403 without the action). Create needs support:edit somewhere
 * (403 otherwise); the service then checks it on the ticket's zone (from the order, else the body).
 */
export function createSupportRoutes(service: SupportService, opts: { appOrigin: string }): Router {
  const router = Router();
  const write = () => [
    originCheck(opts.appOrigin),
    requirePermission('support', 'edit'),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (params: unknown) => parseBody(ticketIdParamsSchema, params).id;

  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(ticketListQuerySchema, req.query)));
  };
  const detail: RequestHandler = async (req, res) => {
    res.json(await service.get(authContextOf(res), id(req.params)));
  };
  const create: RequestHandler = async (req, res) => {
    res
      .status(201)
      .json(await service.create(authContextOf(res), parseBody(createTicketSchema, req.body)));
  };
  const message: RequestHandler = async (req, res) => {
    res
      .status(201)
      .json(
        await service.addMessage(
          authContextOf(res),
          id(req.params),
          parseBody(ticketMessageSchema, req.body),
        ),
      );
  };
  const transition: RequestHandler = async (req, res) => {
    res.json(
      await service.transition(
        authContextOf(res),
        id(req.params),
        versionOf(req),
        parseBody(transitionTicketSchema, req.body),
      ),
    );
  };
  const assign: RequestHandler = async (req, res) => {
    res.json(
      await service.assign(
        authContextOf(res),
        id(req.params),
        versionOf(req),
        parseBody(assignTicketSchema, req.body),
      ),
    );
  };

  router.get('/support/tickets', requirePermission('support', 'view'), list);
  router.get('/support/tickets/:id', requirePermission('support', 'view'), detail);
  router.post('/support/tickets', ...write(), auditMeta(auditOf('createTicket')), create);
  router.post(
    '/support/tickets/:id/messages',
    ...write(),
    auditMeta(auditOf('addTicketMessage')),
    message,
  );
  router.post(
    '/support/tickets/:id/transition',
    ...write(),
    auditMeta(auditOf('transitionTicket')),
    transition,
  );
  router.post(
    '/support/tickets/:id/assign',
    ...write(),
    auditMeta(auditOf('assignTicket')),
    assign,
  );
  return router;
}
