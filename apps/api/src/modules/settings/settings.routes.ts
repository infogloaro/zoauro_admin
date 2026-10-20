import { Router, type RequestHandler } from 'express';
import { parsePermissionKey, SETTING_GROUPS, settingDef, settingsOfGroup } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { requirePermission, type PermissionGuard } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { createSettingsController } from './settings.controller';

type Controller = ReturnType<typeof createSettingsController>;

/**
 * Mounted at /api/v1 after the auth module, whose GET/PUT /settings/security (the 2-step policy) therefore keep
 * answering for group `security`. settings:* is never grantable: Super Admin only, except the zone-delegated keys of
 * D169 (loyalty: GET /settings/loyalty?zoneId= and the zone value routes with loyalty:view / loyalty:edit).
 * Writes: Origin, session CSRF, JSON body and the step-up of D112: STRONG when any key touched needs it (refund limits, SMS provider), else PASSWORD.
 */
export function createSettingsRoutes(
  c: Controller,
  opts: { appOrigin: string; requireReauth: (level: ReauthLevel) => RequestHandler },
): Router {
  const router = Router();
  const password = opts.requireReauth('PASSWORD');
  const strong = opts.requireReauth('STRONG');
  /** the keys a write touches: body.values for PUT, the path key for DELETE */
  const reauthForKeys: RequestHandler = (req, res, next) => {
    const body: unknown = req.body;
    const values =
      typeof body === 'object' && body !== null && 'values' in body
        ? (body as { values: unknown }).values
        : null;
    const keys = [
      ...(typeof values === 'object' && values !== null ? Object.keys(values) : []),
      ...(typeof req.params['key'] === 'string' ? [req.params['key']] : []),
    ];
    // the guards are async: return the promise so a REAUTH_REQUIRED rejection reaches Express
    return keys.some((k) => settingDef(k)?.reauth === 'STRONG')
      ? strong(req, res, next)
      : password(req, res, next);
  };
  const write = [
    originCheck(opts.appOrigin),
    requirePermission('settings', 'edit'),
    requireCsrf,
    requireJsonBody,
  ];
  /**
   * D169: a group with zone-delegated keys (loyalty) is guarded by the delegated permission (a Zonal Admin passes to the
   * service, which checks the zone: 404 / 403); every other group stays settings:* (Super Admin only).
   */
  const byGroup = (action: 'view' | 'edit', opts2: { zoneInRequest?: boolean } = {}) => {
    const fallback = requirePermission('settings', action);
    const guard: RequestHandler = (req, res, next) => {
      const group = req.params['group'];
      const key = typeof group === 'string' ? delegateOf(group, action) : null;
      const parsed = key ? parsePermissionKey(key) : null;
      const g: PermissionGuard = parsed
        ? requirePermission(parsed.module, parsed.action, opts2)
        : fallback;
      return g(req, res, next);
    };
    return Object.assign(guard, { requiredPermission: fallback.requiredPermission });
  };
  const zoneWrite = [
    originCheck(opts.appOrigin),
    byGroup('edit', { zoneInRequest: true }),
    requireCsrf,
    requireJsonBody,
  ];

  router.get('/settings', requirePermission('settings', 'view'), c.list);
  router.get('/settings/history', requirePermission('settings', 'view'), c.history);
  router.get('/settings/:group', byGroup('view'), c.group);
  router.post(
    '/settings/:group/preview',
    originCheck(opts.appOrigin),
    requirePermission('settings', 'view'),
    requireCsrf,
    requireJsonBody,
    auditMeta(auditOf('previewSettings')),
    c.preview,
  );
  router.put('/settings/:group', ...write, reauthForKeys, auditMeta(auditOf('putSettings')), c.put);
  router.delete(
    '/settings/:group/:key',
    ...write,
    reauthForKeys,
    auditMeta(auditOf('resetSetting')),
    c.reset,
  );
  router.put(
    '/zones/:id/settings/:group',
    ...zoneWrite,
    reauthForKeys,
    auditMeta(auditOf('putZoneSettings')),
    c.putZone,
  );
  router.delete(
    '/zones/:id/settings/:group/:key',
    ...zoneWrite,
    reauthForKeys,
    auditMeta(auditOf('resetZoneSetting')),
    c.resetZone,
  );
  return router;
}

/** The delegated permission of a group's zone-delegated keys (D169), or null. */
function delegateOf(group: string, action: 'view' | 'edit'): string | null {
  const g = SETTING_GROUPS.find((x) => x === group);
  if (!g) return null;
  return settingsOfGroup(g).find((d) => d.zoneDelegate)?.zoneDelegate?.[action] ?? null;
}
