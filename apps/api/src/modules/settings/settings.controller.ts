import type { RequestHandler } from 'express';
import {
  previewSettingsSchema,
  putSettingsSchema,
  resetSettingSchema,
  settingGroupParamsSchema,
  settingGroupQuerySchema,
  settingHistoryQuerySchema,
  settingKeyParamsSchema,
  zoneSettingGroupParamsSchema,
  zoneSettingKeyParamsSchema,
} from '@zoauro/shared';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import type { SettingsService } from './settings.service';

// Parse (shared Zod schema) -> call the service -> send. No rules live here.

export function createSettingsController(service: SettingsService) {
  return {
    list: async (_req, res) => {
      res.json(await service.list(authContextOf(res)));
    },
    group: async (req, res) => {
      const { group } = parseBody(settingGroupParamsSchema, req.params);
      const { zoneId } = parseBody(settingGroupQuerySchema, req.query);
      res.json(await service.list(authContextOf(res), group, zoneId));
    },
    preview: async (req, res) => {
      const { group } = parseBody(settingGroupParamsSchema, req.params);
      res.json(
        await service.preview(
          authContextOf(res),
          group,
          parseBody(previewSettingsSchema, req.body),
        ),
      );
    },
    put: async (req, res) => {
      const { group } = parseBody(settingGroupParamsSchema, req.params);
      res.json(
        await service.put(authContextOf(res), group, parseBody(putSettingsSchema, req.body), null),
      );
    },
    reset: async (req, res) => {
      const { group, key } = parseBody(settingKeyParamsSchema, req.params);
      const { reason } = parseBody(resetSettingSchema, req.body);
      res.json(await service.reset(authContextOf(res), group, key, reason, null));
    },
    putZone: async (req, res) => {
      const { id, group } = parseBody(zoneSettingGroupParamsSchema, req.params);
      res.json(
        await service.put(authContextOf(res), group, parseBody(putSettingsSchema, req.body), id),
      );
    },
    resetZone: async (req, res) => {
      const { id, group, key } = parseBody(zoneSettingKeyParamsSchema, req.params);
      const { reason } = parseBody(resetSettingSchema, req.body);
      res.json(await service.reset(authContextOf(res), group, key, reason, id));
    },
    history: async (req, res) => {
      res.json(
        await service.history(authContextOf(res), parseBody(settingHistoryQuerySchema, req.query)),
      );
    },
  } satisfies Record<string, RequestHandler>;
}
