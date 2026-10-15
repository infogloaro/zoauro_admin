import { Router, type RequestHandler } from 'express';
import { settingDef } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { requirePermission } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { createSettingsController } from './settings.controller';

type Controller = ReturnType<typeof createSettingsController>;

/**
 * Mounted at /api/v1 after the auth module, whose GET/PUT /settings/security (the 2-step policy) therefore keep
 * answering for group `security`. settings:* is never grantable: Super Admin only. Writes: Origin, session CSRF, JSON
 * body and the step-up of D112: STRONG when any key touched needs it (refund limits, SMS provider), else PASSWORD.
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

  router.get('/settings', requirePermission('settings', 'view'), c.list);
  router.get('/settings/history', requirePermission('settings', 'view'), c.history);
  router.get('/settings/:group', requirePermission('settings', 'view'), c.group);
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
    ...write,
    reauthForKeys,
    auditMeta(auditOf('putZoneSettings')),
    c.putZone,
  );
  router.delete(
    '/zones/:id/settings/:group/:key',
    ...write,
    reauthForKeys,
    auditMeta(auditOf('resetZoneSetting')),
    c.resetZone,
  );
  return router;
}
