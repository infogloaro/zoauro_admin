import { Router } from 'express';
import {
  createNotificationSchema,
  notificationIdParamsSchema,
  notificationListQuerySchema,
  notificationVersionSchema,
  rejectNotificationSchema,
  updateNotificationSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { NotificationsService } from './notifications.service';

/**
 * Mounted at /api/v1 (D137). Reads need notifications:view and are bounded by its zones; writes need the action
 * somewhere (here) and in every zone the notification names (the service: 404 outside view scope, 403 without the
 * action). Approve and reject: Super Admin only (D94). Mutations: Origin check, session CSRF, JSON body, `version`.
 * Parse -> service -> send; no rules here.
 */
export function createNotificationsRoutes(
  service: NotificationsService,
  opts: { appOrigin: string },
): Router {
  const router = Router();
  const base = '/notifications';
  const write = (action: 'add' | 'edit' | 'status' | 'delete') => [
    originCheck(opts.appOrigin),
    requirePermission('notifications', action),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (params: unknown) => parseBody(notificationIdParamsSchema, params).id;

  router.get(base, requirePermission('notifications', 'view'), async (req, res) => {
    res.json(
      await service.list(authContextOf(res), parseBody(notificationListQuerySchema, req.query)),
    );
  });
  router.post(base, ...write('add'), auditMeta(auditOf('createNotification')), async (req, res) => {
    res
      .status(201)
      .json(
        await service.create(authContextOf(res), parseBody(createNotificationSchema, req.body)),
      );
  });
  router.get(`${base}/:id`, requirePermission('notifications', 'view'), async (req, res) => {
    res.json(await service.get(authContextOf(res), id(req.params)));
  });
  router.patch(
    `${base}/:id`,
    ...write('edit'),
    auditMeta(auditOf('updateNotification')),
    async (req, res) => {
      res.json(
        await service.update(
          authContextOf(res),
          id(req.params),
          parseBody(updateNotificationSchema, req.body),
        ),
      );
    },
  );
  router.post(
    `${base}/:id/approve`,
    ...write('status'),
    auditMeta(auditOf('approveNotification')),
    async (req, res) => {
      res.json(
        await service.approve(
          authContextOf(res),
          id(req.params),
          parseBody(notificationVersionSchema, req.body),
        ),
      );
    },
  );
  router.post(
    `${base}/:id/reject`,
    ...write('status'),
    auditMeta(auditOf('rejectNotification')),
    async (req, res) => {
      res.json(
        await service.reject(
          authContextOf(res),
          id(req.params),
          parseBody(rejectNotificationSchema, req.body),
        ),
      );
    },
  );
  router.post(
    `${base}/:id/cancel`,
    ...write('delete'),
    auditMeta(auditOf('cancelNotification')),
    async (req, res) => {
      res.json(
        await service.cancel(
          authContextOf(res),
          id(req.params),
          parseBody(notificationVersionSchema, req.body),
        ),
      );
    },
  );
  return router;
}
