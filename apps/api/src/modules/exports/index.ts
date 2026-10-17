import type { ExportModule } from '@zoauro/shared';
import type { ExportFileStore, ExportSource } from '../../lib/exports';
import type { OrdersService } from '../orders';
import { ExportsDatabase } from './exports.repository';
import { createExportsRoutes } from './exports.routes';
import { ExportsService, type ContextBuilder } from './exports.service';
import { ordersExportSource } from './sources/orders.source';

// Export jobs (doc 09 GET /orders/export, GET /exports/{id}; D129). The API builds it with an enqueue function; the
// worker builds it with the access service (to rebuild the requester's context) and runs the jobs.

export {
  createExportQueue,
  startExportJobs,
  EXPORTS_QUEUE,
  type ExportQueue,
} from './exports.jobs';
export { ExportsService, MAX_ACTIVE_EXPORTS } from './exports.service';

type ExportsDeps = {
  prisma: ConstructorParameters<typeof ExportsDatabase>[0];
  orders: Pick<OrdersService, 'list'>;
  files: ExportFileStore;
  enqueue: (exportId: string) => Promise<void>;
  contexts?: ContextBuilder;
  clock?: () => Date;
  log?: (line: string) => void;
};

/** The service alone: the worker runs jobs and never serves routes. */
export function createExportsService(deps: ExportsDeps): ExportsService {
  const sources = new Map<ExportModule, ExportSource>([
    ['orders', ordersExportSource(deps.orders)],
  ]);
  return new ExportsService({
    db: new ExportsDatabase(deps.prisma),
    sources,
    files: deps.files,
    enqueue: deps.enqueue,
    clock: deps.clock ?? (() => new Date()),
    ...(deps.contexts ? { contexts: deps.contexts } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  });
}

/** Service + routes (API). */
export function createExportsModule(deps: ExportsDeps) {
  const service = createExportsService(deps);
  return { router: createExportsRoutes(service), service };
}
