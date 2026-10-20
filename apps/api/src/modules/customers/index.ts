import type { Router } from 'express';
import type { RateLimiter } from '../../lib/rate-limiter';
import { CustomersDatabase } from './customers.repository';
import { createCustomersRoutes } from './customers.routes';
import { CustomersService } from './customers.service';

export { CustomersService } from './customers.service';

/** M09 Customers (doc 09, D14, D25, D26, D28, D63). */
export function createCustomersModule(deps: {
  prisma: ConstructorParameters<typeof CustomersDatabase>[0];
  appOrigin: string;
  limiter: RateLimiter;
  clock?: () => Date;
}): { router: Router; service: CustomersService } {
  const service = new CustomersService({
    db: new CustomersDatabase(deps.prisma),
    limiter: deps.limiter,
    clock: deps.clock ?? (() => new Date()),
  });
  return { router: createCustomersRoutes(service, { appOrigin: deps.appOrigin }), service };
}
