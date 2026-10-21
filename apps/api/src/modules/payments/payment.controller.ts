import type { NextFunction, Request, Response } from 'express';
import { listPaymentsQuerySchema } from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../lib/auth-context';
import * as service from './payment.service';

function actor(req: Request): AuthContext {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth;
}

export async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const a = actor(req);
    // Defense in depth behind requireSuperAdmin; authorization runs before
    // validation so a member without access sees 403, never 422.
    if (!a.isSuperAdmin) throw errors.forbidden();
    const query = listPaymentsQuerySchema.parse(req.query);
    const result = await service.list(a, query);
    res.json({
      data: result.items,
      meta: { total: result.total, page: query.page, pageSize: query.pageSize },
    });
  } catch (e) {
    next(e);
  }
}
