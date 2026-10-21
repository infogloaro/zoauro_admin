import express, { type Express } from 'express';
import { prisma } from './lib/db';
import { errorHandler, apiNotFound } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { authenticate } from './middleware/authenticate';
import { authRouter } from './modules/auth';
import { zonesRouter } from './modules/zones';
import { restaurantsRouter } from './modules/restaurants';
import { homemakersRouter } from './modules/homemakers';
import { uploadsRouter } from './modules/uploads';
import { hotelsRouter } from './modules/hotels';
import { menuItemsRouter } from './modules/menu';
import { notificationsRouter } from './modules/notifications';
import { paymentsRouter } from './modules/payments';
import { customersRouter } from './modules/customers';
import { deliveryPartnersRouter } from './modules/delivery-partners';
import { thirdPartyProvidersRouter } from './modules/third-party-providers';
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));

  // Liveness: process is up.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: database reachable (doc 12; F0.4 added the datasource).
  app.get('/api/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', checks: { database: 'ok' } });
    } catch {
      res.status(503).json({ status: 'unavailable', checks: { database: 'down' } });
    }
  });

  const v1 = express.Router();
  v1.use(authenticate);
  v1.use(authRouter);
  v1.use('/zones', zonesRouter);
  v1.use('/restaurants', restaurantsRouter);
  v1.use('/homemakers', homemakersRouter);
  v1.use('/uploads', uploadsRouter);
  v1.use('/hotels', hotelsRouter);
  v1.use('/menu-items', menuItemsRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/payments', paymentsRouter);
  v1.use('/customers', customersRouter);
  v1.use('/delivery-partners', deliveryPartnersRouter);
  v1.use('/third-party-providers', thirdPartyProvidersRouter);
  app.use('/api/v1', v1);

  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return app;
}
