import express, { type Express, type RequestHandler } from 'express';

import { createOrderRoutes } from './modules/orders';
import { createOrderRepository } from './modules/orders/prisma-repository';
import { OrderService } from './modules/orders/service';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/ready', (_req, res) => {
    res.json({ status: 'ok', checks: {} });
  });

  // Local testing only. Replace with real authentication before production.
  const testAuthenticate: RequestHandler = (req, res, next) => {
    const userId = req.header('x-test-user-id');

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Provide x-test-user-id for local testing',
      });
      return;
    }

    (
      req as typeof req & {
        auth?: {
          userId: string;
          role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
          zoneIds?: readonly string[];
        };
      }
    ).auth = {
      userId,
      role: 'SUPER_ADMIN',
      zoneIds: [],
    };

    next();
  };

  const repository = createOrderRepository();
  const service = new OrderService(repository);

  app.use('/api/v1/orders', createOrderRoutes(service, testAuthenticate));

  return app;
}
