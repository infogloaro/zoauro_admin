import type { Request, RequestHandler } from 'express';
import { authContextOf } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import {
  orderCancelSchema,
  orderIdParamsSchema,
  orderListQuerySchema,
  orderTransitionSchema,
} from './schemas';
import type { OrderService } from './service';

// Parse (shared Zod schemas) -> call the service -> send. No rules live here. Errors are AppErrors and reach the app's
// error handler, which answers in the doc 09 error format.

/** If-Match: the order version the client last saw (doc 09 "Optimistic locking"); `3` or `"3"`. */
export function ifMatchVersion(req: Request): number {
  const raw = req.header('If-Match')?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(version) || version < 1)
    throw new AppError('VALIDATION_ERROR', 'Invalid input', [
      { field: 'If-Match', issue: 'required' },
    ]);
  return version;
}

export function createOrderController(service: OrderService) {
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(orderListQuerySchema, req.query)));
  };
  const detail: RequestHandler = async (req, res) => {
    const { id } = parseBody(orderIdParamsSchema, req.params);
    res.json(await service.detail(authContextOf(res), id));
  };
  const transition: RequestHandler = async (req, res) => {
    const ctx = authContextOf(res);
    const { id } = parseBody(orderIdParamsSchema, req.params);
    const input = parseBody(orderTransitionSchema, req.body);
    res.json(await service.transition(ctx, id, ifMatchVersion(req), input));
  };
  const cancel: RequestHandler = async (req, res) => {
    const ctx = authContextOf(res);
    const { id } = parseBody(orderIdParamsSchema, req.params);
    const input = parseBody(orderCancelSchema, req.body);
    res.json(await service.cancel(ctx, id, ifMatchVersion(req), input));
  };
  return { list, detail, transition, cancel };
}
