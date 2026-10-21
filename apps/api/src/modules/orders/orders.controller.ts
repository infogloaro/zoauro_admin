import type { Request, RequestHandler } from 'express';
import {
  assignOrderSchema,
  cancelOrderSchema,
  orderIdParamsSchema,
  orderIfMatchSchema,
  orderListQuerySchema,
  transitionOrderSchema,
} from '@zoauro/shared';
import { authContextOf } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import type { OrdersService } from './orders.service';

// Parse (shared Zod schema) -> call the service -> send. No rules live here.

/** Doc 09: every order write carries `If-Match: <version>`; missing or malformed is 422 on the header. */
function versionOf(req: Request): number {
  const parsed = orderIfMatchSchema.safeParse(req.get('If-Match'));
  if (parsed.success) return parsed.data;
  throw new AppError('VALIDATION_ERROR', 'Send the order version in the If-Match header', [
    { field: 'If-Match', issue: req.get('If-Match') === undefined ? 'required' : 'invalid' },
  ]);
}

export function createOrdersController(service: OrdersService) {
  const id = (params: unknown) => parseBody(orderIdParamsSchema, params).id;

  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(orderListQuerySchema, req.query)));
  };

  const detail: RequestHandler = async (req, res) => {
    res.json(await service.get(authContextOf(res), id(req.params)));
  };

  const transition: RequestHandler = async (req, res) => {
    res.json(
      await service.transition(
        authContextOf(res),
        id(req.params),
        versionOf(req),
        parseBody(transitionOrderSchema, req.body),
      ),
    );
  };

  const cancel: RequestHandler = async (req, res) => {
    const body = cancelOrderSchema.safeParse(req.body);
    // doc 10: a cancellation without a reason is REASON_REQUIRED, like the zone deactivation
    if (!body.success && body.error.issues.some((i) => i.path[0] === 'reasonCode'))
      throw new AppError('REASON_REQUIRED', 'Give a reason for the cancellation', [
        { field: 'reasonCode', issue: 'required' },
      ]);
    res.json(
      await service.cancel(
        authContextOf(res),
        id(req.params),
        versionOf(req),
        parseBody(cancelOrderSchema, req.body),
      ),
    );
  };

  const assign: RequestHandler = async (req, res) => {
    res.json(
      await service.assign(
        authContextOf(res),
        id(req.params),
        versionOf(req),
        parseBody(assignOrderSchema, req.body),
      ),
    );
  };

  const cancelReasons: RequestHandler = async (req, res) => {
    res.json(await service.cancelReasons(authContextOf(res), id(req.params)));
  };

  return { list, detail, transition, cancel, assign, cancelReasons };
}
