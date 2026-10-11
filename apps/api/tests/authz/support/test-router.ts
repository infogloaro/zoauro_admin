import { Router } from 'express';
import {
  assertCanRead,
  assertCanWrite,
  authContextOf,
  requirePermission,
  zonesFor,
} from '../../../src/lib/authz';

// Test-only routes that exercise the guards the way real modules will: route guard first, then the zone check where the
// object's zone is known, then the scope for lists.

const zoneParam = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

export function createTestRouter(): Router {
  const router = Router();

  // list: scope comes from zonesFor
  router.get('/_t/orders', requirePermission('orders', 'view'), (_req, res) => {
    res.json({ scope: zonesFor(authContextOf(res), 'orders:view') });
  });
  router.get('/_t/payments', requirePermission('payments', 'view'), (_req, res) => {
    res.json({ scope: zonesFor(authContextOf(res), 'payments:view') });
  });

  // object read in a known zone
  router.get('/_t/orders/in/:zoneId', requirePermission('orders', 'view'), (req, res) => {
    assertCanRead(authContextOf(res), 'orders:view', zoneParam(req.params['zoneId']));
    res.json({ ok: true });
  });

  // write in a known zone
  router.patch('/_t/orders/in/:zoneId', requirePermission('orders', 'edit'), (req, res) => {
    assertCanWrite(authContextOf(res), 'orders:edit', zoneParam(req.params['zoneId']));
    res.json({ ok: true });
  });

  // modules a Zonal Admin can never hold
  router.get('/_t/access', requirePermission('access', 'view'), (_req, res) => {
    res.json({ ok: true });
  });
  router.put('/_t/access', requirePermission('access', 'edit'), (_req, res) => {
    res.json({ ok: true });
  });

  // what the context looks like for the caller
  router.get('/_t/ctx', requirePermission('dashboard', 'view'), (_req, res) => {
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
  });

  return router;
}
