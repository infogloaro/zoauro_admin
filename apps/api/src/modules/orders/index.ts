import type { Router } from 'express';
import { createOrdersController } from './orders.controller';
import { OrdersDatabase } from './orders.repository';
import { createOrdersRoutes } from './orders.routes';
import { OrdersService } from './orders.service';

// Orders (M11): list, detail, transition, cancel, assign (doc 09). Ported from magaraj's dev_cb onto the core (D117).

export { OrdersService } from './orders.service';

export function createOrdersModule(deps: {
  prisma: ConstructorParameters<typeof OrdersDatabase>[0];
  appOrigin: string;
  /** D121: the effective `delivery.maxConcurrentOrders` of a zone (settings reader) */
  maxConcurrentOrders: (zoneId: string) => Promise<number>;
  clock?: () => Date;
}): { router: Router; service: OrdersService } {
  const service = new OrdersService({
    db: new OrdersDatabase(deps.prisma),
    clock: deps.clock ?? (() => new Date()),
    maxConcurrentOrders: deps.maxConcurrentOrders,
  });
  return {
    router: createOrdersRoutes(createOrdersController(service), { appOrigin: deps.appOrigin }),
    service,
  };
}
