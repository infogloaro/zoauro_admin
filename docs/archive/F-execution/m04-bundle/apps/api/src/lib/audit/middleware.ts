import type { NextFunction, Request, Response } from 'express';
import { getAuditContext, runWithAuditContext } from './context';
import type { AuditActor } from './context';
import { evaluateCoverage } from './coverage';
import type { AuditRouteMeta, CoverageViolation } from './coverage';

/** 1) Request context. Install AFTER authentication. Without an actor no context exists and record() throws NO_ACTOR (by design). */
export function auditContextMiddleware(opts: {
  resolveActor: (req: Request) => AuditActor | undefined;
  getRequestId: (req: Request) => string | undefined;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = opts.resolveActor(req);
    if (!actor) { next(); return; }
    runWithAuditContext(
      { actor, ip: req.ip, userAgent: req.get('user-agent') ?? undefined, requestId: opts.getRequestId(req) },
      () => next(),
    );
  };
}

/** 2) Route metadata: router.post('/x', auditMeta({ module, action }), handler) or auditMeta({ none: 'logout' }). */
export function auditMeta(meta: AuditRouteMeta) {
  return (_req: Request, res: Response, next: NextFunction): void => { res.locals['auditMeta'] = meta; next(); };
}

/** 3) Coverage guard. Install after the context middleware. mode "throw" (tests) fails the run; "log" (production) reports and continues. */
export function auditCoverage(opts: {
  mode: 'throw' | 'log' | 'collect';
  logger?: { error: (obj: object, msg: string) => void };
  onViolation?: (v: CoverageViolation) => void;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = getAuditContext();
    res.on('finish', () => {
      const v = evaluateCoverage({
        method: req.method, path: (req.baseUrl + (req.route?.path ?? req.path)) || req.originalUrl,
        status: res.statusCode, meta: res.locals['auditMeta'],
        rowsWritten: ctx?.rowsWritten ?? 0, noops: ctx?.noops ?? 0,
      });
      if (!v) return;
      opts.onViolation?.(v);
      if (opts.mode === 'log') opts.logger?.error({ violation: v }, 'audit coverage violation');
      if (opts.mode === 'throw') process.nextTick(() => { throw new Error(`audit coverage violation: ${JSON.stringify(v)}`); });
    });
    next();
  };
}
