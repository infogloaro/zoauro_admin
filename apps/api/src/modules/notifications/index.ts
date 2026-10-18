import type { Router } from 'express';
import type { Mailer } from '../../lib/mailer';
import { NotificationsDatabase } from './notifications.repository';
import { createNotificationsRoutes } from './notifications.routes';
import {
  NotificationsService,
  type NotificationChannelsSource,
  type NotificationQueue,
} from './notifications.service';

// Notifications (M17; D94, D99, D100, D134–D137): compose, approval for promotions, one send per zone at its own
// window, broadcast.created to the apps, email batches. The API enqueues; the worker sends (notifications.jobs.ts).

export { NotificationsService } from './notifications.service';
export { createNotificationQueue, startNotificationJobs } from './notifications.jobs';

export function createNotificationsModule(deps: {
  prisma: ConstructorParameters<typeof NotificationsDatabase>[0];
  appOrigin: string;
  /** settings reader: notificationChannels() and notificationTiming(zoneId) */
  settings: NotificationChannelsSource;
  queue: NotificationQueue;
  mailer: Mailer;
  clock?: () => Date;
  log?: (line: string) => void;
}): { router: Router; service: NotificationsService } {
  const service = new NotificationsService({
    db: new NotificationsDatabase(deps.prisma),
    clock: deps.clock ?? (() => new Date()),
    settings: deps.settings,
    queue: deps.queue,
    mailer: deps.mailer,
    ...(deps.log ? { log: deps.log } : {}),
  });
  return {
    router: createNotificationsRoutes(service, { appOrigin: deps.appOrigin }),
    service,
  };
}
