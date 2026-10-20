import type { Router } from 'express';
import { createOrderController } from './controller';
import { OrdersDatabase } from './prisma-repository';
import { createOrderRoutes } from './routes';
import { OrderService } from './service';

export { OrderService, addressLine, ORDER_CANCELLED, ORDER_STATUS_CHANGED } from './service';
export { ifMatchVersion } from './controller';
export type { OrderRepository } from './repository';
export type * from './types';

/** M11 Orders (doc 09, doc 10 section 1). server.ts mounts the router under /api/v1, behind the session. */
export function createOrdersModule(deps: {
  prisma: ConstructorParameters<typeof OrdersDatabase>[0];
  appOrigin: string;
  clock?: () => Date;
}): { router: Router } {
  const service = new OrderService(new OrdersDatabase(deps.prisma), deps.clock);
  return {
    router: createOrderRoutes(createOrderController(service), { appOrigin: deps.appOrigin }),
  };
}
