import { Router, type RequestHandler } from 'express';
import type { PermissionAction } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { requirePermission } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { createAccessAdminController } from './access-admin.controller';

type Controller = ReturnType<typeof createAccessAdminController>;

/**
 * Mounted at /api/v1 (doc 09 "Zonal admins and access"). admins:* and access:* are never grantable, so only a Super Admin
 * passes; a Zonal Admin gets 403 (TC-AC-7). Mutations: Origin check, session CSRF, JSON body, and the step-up of D107:
 * PASSWORD for access, profiles, team, delete, reset-password and revoke-sessions; STRONG for an email change.
 */
export function createAccessAdminRoutes(
  c: Controller,
  opts: { appOrigin: string; requireReauth: (level: ReauthLevel) => RequestHandler },
): Router {
  const router = Router();
  const write = (module: 'admins' | 'access', action: PermissionAction) => [
    originCheck(opts.appOrigin),
    requirePermission(module, action),
    requireCsrf,
  ];
  const password = opts.requireReauth('PASSWORD');
  const strong = opts.requireReauth('STRONG');
  /** D107: only an email change needs STRONG; name, phone and status need none */
  const strongForEmail: RequestHandler = (req, res, next) => {
    const body: unknown = req.body;
    if (
      typeof body === 'object' &&
      body !== null &&
      Object.prototype.hasOwnProperty.call(body, 'email')
    ) {
      // the guard is async: its rejection (REAUTH_REQUIRED) must reach Express, so the promise is returned
      return strong(req, res, next);
    }
    next();
  };

  // members
  router.get('/zonal-admins', requirePermission('admins', 'view'), c.listMembers);
  router.post(
    '/zonal-admins',
    ...write('admins', 'add'),
    requireJsonBody,
    auditMeta(auditOf('createZonalAdmin')),
    c.createMember,
  );
  router.get('/zonal-admins/:id', requirePermission('admins', 'view'), c.getMember);
  router.patch(
    '/zonal-admins/:id',
    ...write('admins', 'edit'),
    requireJsonBody,
    strongForEmail,
    auditMeta(auditOf('updateZonalAdmin')),
    c.updateMember,
  );
  router.delete(
    '/zonal-admins/:id',
    ...write('admins', 'delete'),
    password,
    auditMeta(auditOf('deleteZonalAdmin')),
    c.deleteMember,
  );
  router.post(
    '/zonal-admins/:id/reset-password',
    ...write('admins', 'edit'),
    password,
    requireJsonBody,
    auditMeta(auditOf('resetZonalAdminPassword')),
    c.resetPassword,
  );
  router.post(
    '/zonal-admins/:id/revoke-sessions',
    ...write('admins', 'edit'),
    password,
    auditMeta(auditOf('revokeZonalAdminSessions')),
    c.revokeSessions,
  );

  // a member's access
  router.get('/zonal-admins/:id/access', requirePermission('access', 'view'), c.getAccess);
  router.put(
    '/zonal-admins/:id/access',
    ...write('access', 'edit'),
    password,
    requireJsonBody,
    auditMeta(auditOf('putMemberAccess')),
    c.putAccess,
  );
  router.get('/zonal-admins/:id/access/preview', requirePermission('access', 'view'), c.preview);

  // zone team (GET /zones/:id/team is served by the zones module)
  router.post(
    '/zones/:id/team/:userId',
    ...write('access', 'edit'),
    password,
    requireJsonBody,
    auditMeta(auditOf('addZoneTeamMember')),
    c.addTeamMember,
  );
  router.delete(
    '/zones/:id/team/:userId',
    ...write('access', 'edit'),
    password,
    auditMeta(auditOf('removeZoneTeamMember')),
    c.removeTeamMember,
  );

  // history
  router.get('/access-changes', requirePermission('access', 'view'), c.listAccessChanges);

  // profiles
  router.get('/access-profiles', requirePermission('access', 'view'), c.listProfiles);
  router.post(
    '/access-profiles',
    ...write('access', 'add'),
    password,
    requireJsonBody,
    auditMeta(auditOf('createAccessProfile')),
    c.createProfile,
  );
  router.get('/access-profiles/:id', requirePermission('access', 'view'), c.getProfile);
  router.patch(
    '/access-profiles/:id',
    ...write('access', 'edit'),
    password,
    requireJsonBody,
    auditMeta(auditOf('updateAccessProfile')),
    c.updateProfile,
  );
  router.delete(
    '/access-profiles/:id',
    ...write('access', 'delete'),
    password,
    auditMeta(auditOf('deleteAccessProfile')),
    c.deleteProfile,
  );
  router.get(
    '/access-profiles/:id/permissions',
    requirePermission('access', 'view'),
    c.getProfilePermissions,
  );
  router.put(
    '/access-profiles/:id/permissions',
    ...write('access', 'edit'),
    password,
    requireJsonBody,
    auditMeta(auditOf('putAccessProfilePermissions')),
    c.putProfilePermissions,
  );
  return router;
}
