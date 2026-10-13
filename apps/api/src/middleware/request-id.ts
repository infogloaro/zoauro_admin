import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Correlates logs and error bodies with the client (doc 09 error envelope). */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-request-id'];
  const id =
    typeof header === 'string' && header.length > 0 && header.length <= 128 ? header : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
