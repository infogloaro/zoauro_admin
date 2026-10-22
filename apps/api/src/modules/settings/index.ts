import type { RequestHandler, Router } from 'express';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { createSettingsController } from './settings.controller';
import { SettingsDatabase } from './settings.repository';
import { createSettingsRoutes } from './settings.routes';
import { SettingsReader, SettingsService } from './settings.service';

export { SettingsReader } from './settings.service';

/**
 * Platform settings (doc 59, D109–D116): the registry's values, zone overrides, preview, history. `reader` gives other
 * modules effective values (the access context clamps refund limits to the zone caps with it, D110).
 */
export function createSettingsModule(deps: {
  prisma: ConstructorParameters<typeof SettingsDatabase>[0];
  appOrigin: string;
  requireReauth: (level: ReauthLevel) => RequestHandler;
  /** an SMS provider is configured in the environment (D99: SMS cannot be switched on without one) */
  smsReady: () => boolean;
  /** D178: the Control Panel area guard (the access module's ControlAreasService) */
  requireArea?: (area: (req: Parameters<RequestHandler>[0]) => string | null) => RequestHandler;
  /** D178: the settings groups a Super Admin's areas allow ('ALL' for a primary) */
  groupsOf?: (userId: string) => Promise<readonly string[] | 'ALL'>;
  clock?: () => Date;
}): { router: Router; service: SettingsService; reader: SettingsReader } {
  const db = new SettingsDatabase(deps.prisma);
  const clock = deps.clock ?? (() => new Date());
  const reader = new SettingsReader({ repo: db.repo, now: () => clock().getTime() });
  const service = new SettingsService({
    db,
    clock,
    smsReady: deps.smsReady,
    onChanged: () => reader.clear(),
    ...(deps.groupsOf ? { groupsOf: deps.groupsOf } : {}),
  });
  return {
    router: createSettingsRoutes(createSettingsController(service), {
      appOrigin: deps.appOrigin,
      requireReauth: deps.requireReauth,
      ...(deps.requireArea ? { requireArea: deps.requireArea } : {}),
    }),
    service,
    reader,
  };
}
