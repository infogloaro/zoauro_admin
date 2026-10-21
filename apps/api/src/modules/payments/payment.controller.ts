import type { NextFunction, Request, Response } from 'express';
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
    if (!a.isSuperAdmin) throw errors.forbidden();
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 6) || 6));
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const method = typeof req.query.method === 'string' ? req.query.method : undefined;
    const result = await service.list({ userId: a.userId }, { page, pageSize, q, status, method });
    res.json({ data: result.items, meta: { total: result.total, page, pageSize } });
  } catch (e) {
    next(e);
  }
}
