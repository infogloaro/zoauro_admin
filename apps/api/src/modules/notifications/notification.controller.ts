import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../lib/auth-context';
import * as service from './notification.service';

function actor(req: Request): AuthContext {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth;
}

export async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const a = actor(req);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
    const read = (req.query.read as string) ?? 'all';
    const result = await service.list(
      { userId: a.userId },
      { page, pageSize, read: read as 'read' | 'unread' | 'all' },
    );
    res.json({ data: result.items, meta: { total: result.total, page, pageSize } });
  } catch (e) {
    next(e);
  }
}

export async function countHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const a = actor(req);
    const count = await service.countUnread({ userId: a.userId });
    res.json({ data: { count } });
  } catch (e) {
    next(e);
  }
}

export async function markReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const a = actor(req);
    const ok = await service.markOneRead({ userId: a.userId }, String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
      return;
    }
    res.json({ data: { ok: true } });
  } catch (e) {
    next(e);
  }
}

export async function markAllReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const a = actor(req);
    const count = await service.markAll({ userId: a.userId });
    res.json({ data: { count } });
  } catch (e) {
    next(e);
  }
}

export async function streamHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const a = actor(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const keep = setInterval(() => res.write(': keepalive\n\n'), 25000);
    req.on('close', () => clearInterval(keep));
    // initial unread count
    const count = await service.countUnread({ userId: a.userId });
    res.write(`event: unread-count\ndata: ${JSON.stringify({ count })}\n\n`);
  } catch (e) {
    next(e);
  }
}
