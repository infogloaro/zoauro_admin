import { Router, type Response } from 'express';
import {
  assertCanRead,
  assertCanWrite,
  authContextOf,
  can,
  requirePermission,
  zonesFor,
} from '../../../src/lib/authz';
import { auditMeta, noteAuditNoop } from '../../../src/lib/audit';
import { requireCsrf, requireSession } from '../../../src/lib/auth/middleware';
import { AppError } from '../../../src/lib/errors';

// Test-only routes that exercise the guards the way real modules will: route guard first, then the zone check where the
// object's zone is known, then the scope for lists. The `mutant` option builds deliberately broken versions, which the
// authorization matrix must detect (matrix/engine-detects.test.ts).

export type Mutant =
  | 'leaky-list' // a list that ignores the caller's zones
  | 'wrong-code' // 403 instead of 404 for an object in a zone the caller cannot see
  | 'no-session' // a route with no authentication at all
  | 'undocumented' // an extra route that is not in the OpenAPI document
  | 'weak-guard' // a never-grantable module reachable by a Zonal Admin
  | 'missing-csrf' // state-changing routes that skip the CSRF check
  | 'no-audit-meta'; // a state-changing route that declares no audit metadata

const zoneParam = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

export function createTestRouter(opts: { csrf?: boolean; mutant?: Mutant } = {}): Router {
  const router = Router();
  const csrf = opts.csrf && opts.mutant !== 'missing-csrf' ? [requireCsrf] : [];
  // The writes below change nothing, so each counts as an audited no-op (as a real module's identical update would).
  const audited = (action: 'order.marked_delayed' | 'access.profile_set') => [
    auditMeta({ module: action === 'access.profile_set' ? 'access' : 'orders', action }),
  ];

  // list: scope comes from zonesFor
  router.get('/_t/orders', requirePermission('orders', 'view'), (_req, res) => {
    const ctx = authContextOf(res);
    res.json({
      scope: opts.mutant === 'leaky-list' ? { kind: 'ALL' } : zonesFor(ctx, 'orders:view'),
    });
  });
  router.get('/_t/payments', requirePermission('payments', 'view'), (_req, res) => {
    res.json({ scope: zonesFor(authContextOf(res), 'payments:view') });
  });

  // object read in a known zone
  router.get('/_t/orders/in/:zoneId', requirePermission('orders', 'view'), (req, res) => {
    const ctx = authContextOf(res);
    const zone = zoneParam(req.params['zoneId']);
    if (opts.mutant === 'wrong-code') {
      if (!can(ctx, 'orders:view', zone)) throw new AppError('FORBIDDEN', 'No');
    } else {
      assertCanRead(ctx, 'orders:view', zone);
    }
    res.json({ ok: true });
  });

  // write in a known zone
  router.patch(
    '/_t/orders/in/:zoneId',
    requirePermission('orders', 'edit', { zoneInRequest: true }),
    ...csrf,
    ...audited('order.marked_delayed'),
    (req, res) => {
      assertCanWrite(authContextOf(res), 'orders:edit', zoneParam(req.params['zoneId']));
      noteAuditNoop();
      res.json({ ok: true });
    },
  );

  // write that names no zone (bulk): the route guard itself needs the action in at least one zone
  router.patch(
    '/_t/orders',
    requirePermission('orders', 'edit'),
    ...csrf,
    ...(opts.mutant === 'no-audit-meta' ? [] : audited('order.marked_delayed')),
    (_req, res) => {
      noteAuditNoop();
      res.json({ ok: true });
    },
  );

  // modules a Zonal Admin can never hold
  router.get(
    '/_t/access',
    opts.mutant === 'weak-guard' ? requireSession() : requirePermission('access', 'view'),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  router.put(
    '/_t/access',
    requirePermission('access', 'edit'),
    ...csrf,
    ...audited('access.profile_set'),
    (_req, res) => {
      noteAuditNoop();
      res.json({ ok: true });
    },
  );

  // what the context looks like for the caller
  const ctxHandler = (_req: unknown, res: Response) => {
    if (opts.mutant === 'no-session') {
      res.json({ ok: true });
      return;
    }
    const ctx = authContextOf(res);
    res.json({
      userId: ctx.userId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      assignedZoneIds: ctx.assignedZoneIds,
      permissions: Object.fromEntries(
        [...ctx.permissionsByZone].map(([z, s]) => [z, [...s].sort()]),
      ),
      limits: Object.fromEntries(ctx.limitsByZone),
      requestedZoneIds: ctx.requestedZoneIds,
    });
  };
  if (opts.mutant === 'no-session') router.get('/_t/ctx', ctxHandler);
  else router.get('/_t/ctx', requirePermission('dashboard', 'view'), ctxHandler);

  if (opts.mutant === 'undocumented') {
    router.get('/_t/secret', (_req, res) => {
      res.json({ secret: true });
    });
  }

  return router;
}
