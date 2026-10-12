import { Router } from 'express';
import type { AuthController } from './controller';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.post('/change-password', controller.changePassword);

  return router;
}
