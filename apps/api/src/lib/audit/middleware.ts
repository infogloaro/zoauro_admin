import type { NextFunction, Request, Response } from 'express';
import { runWithAuditContext, runWithAuditTally } from './context';
import type { AuditActor, AuditTally } from './context';
import { evaluateCoverage } from './coverage';
import type { AuditRouteMeta, CoverageViolation } from './coverage';

/** 1) Request context. Install AFTER authentication. Without an actor no context exists and record() throws NO_ACTOR (by design). */
export function auditContextMiddleware(opts: {
  resolveActor: (req: Request) => AuditActor | undefined;
  getRequestId: (req: Request) => string | undefined;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = opts.resolveActor(req);
    if (!actor) {
      next();
      return;
    }
    runWithAuditContext(
      {
        actor,
        ip: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
        requestId: opts.getRequestId(req),
      },
      () => next(),
    );
  };
}

export type AuditMetaHandler = ((req: Request, res: Response, next: NextFunction) => void) & {
  /** read by the authorization harness from the route stack and compared with the operation's x-audit */
  auditMeta: AuditRouteMeta;
};

/** 2) Route metadata: router.post('/x', auditMeta({ module, action }), handler) or auditMeta({ none: 'logout' }). */
export function auditMeta(meta: AuditRouteMeta): AuditMetaHandler {
  const handler = (_req: Request, res: Response, next: NextFunction): void => {
    res.locals['auditMeta'] = meta;
    next();
  };
  return Object.assign(handler, { auditMeta: meta });
}

/** 3) Coverage guard. Install before the routes. mode "throw" (tests) fails the run; "log" (production) reports and continues. */
export function auditCoverage(opts: {
  mode: 'throw' | 'log' | 'collect';
  logger?: { error: (obj: object, msg: string) => void };
  onViolation?: (v: CoverageViolation) => void;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tally: AuditTally = { rowsWritten: 0, noops: 0 };
    res.on('finish', () => {
      const v = evaluateCoverage({
        method: req.method,
        path: req.baseUrl + (req.route?.path ?? req.path) || req.originalUrl,
        status: res.statusCode,
        meta: res.locals['auditMeta'],
        rowsWritten: tally.rowsWritten,
        noops: tally.noops,
      });
      if (!v) return;
      opts.onViolation?.(v);
      if (opts.mode === 'log') opts.logger?.error({ violation: v }, 'audit coverage violation');
      if (opts.mode === 'throw')
        process.nextTick(() => {
          throw new Error(`audit coverage violation: ${JSON.stringify(v)}`);
        });
    });
    runWithAuditTally(tally, () => next());
  };
}
