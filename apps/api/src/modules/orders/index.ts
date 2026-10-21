import type { Router } from 'express';
import { orderOverviewQuerySchema, type OrderSla } from '@zoauro/shared';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { createOrdersController } from './orders.controller';
import { OrdersDatabase } from './orders.repository';
import { createOrdersRoutes } from './orders.routes';
import { OrdersService } from './orders.service';
import { OrderOverviewService } from './overview.service';

// Orders (M11): list, detail, transition, cancel, assign (doc 09). Ported from magaraj's dev_cb onto the core (D117).

export { OrdersService } from './orders.service';

export function createOrdersModule(deps: {
  prisma: ConstructorParameters<typeof OrdersDatabase>[0];
  appOrigin: string;
  /** D121: the effective `delivery.maxConcurrentOrders` of a zone (settings reader) */
  maxConcurrentOrders: (zoneId: string) => Promise<number>;
  /** D169: the rewards module's earnForDeliveredOrder */
  onDelivered?: (orderId: string) => Promise<unknown>;
  /** D179 section 3: settings orders.sla of a zone (null = platform); absent: the defaults */
  sla?: (zoneId: string | null) => Promise<OrderSla>;
  clock?: () => Date;
}): { router: Router; service: OrdersService; overview: OrderOverviewService } {
  const clock = deps.clock ?? (() => new Date());
  const overview = new OrderOverviewService({
    prisma: deps.prisma,
    clock,
    ...(deps.sla ? { sla: deps.sla } : {}),
  });
  const service = new OrdersService({
    db: new OrdersDatabase(deps.prisma),
    clock,
    maxConcurrentOrders: deps.maxConcurrentOrders,
    ...(deps.onDelivered ? { onDelivered: deps.onDelivered } : {}),
    delayedIds: (ctx) => overview.delayedIds(ctx),
  });
  return {
    router: createOrdersRoutes(createOrdersController(service), {
      appOrigin: deps.appOrigin,
      overview: async (req, res) => {
        res.json(
          await overview.overview(
            authContextOf(res),
            parseBody(orderOverviewQuerySchema, req.query),
          ),
        );
      },
    }),
    service,
    overview,
  };
}
