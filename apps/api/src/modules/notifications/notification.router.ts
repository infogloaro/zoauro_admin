import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import * as c from './notification.controller';

export const notificationsRouter: Router = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get('/', c.listHandler);
notificationsRouter.get('/unread-count', c.countHandler);
notificationsRouter.get('/stream', c.streamHandler);
notificationsRouter.patch('/:id/read', c.markReadHandler);
notificationsRouter.patch('/read-all', c.markAllReadHandler);
