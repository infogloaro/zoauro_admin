import type { Router } from 'express';
import { createAuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { createAuditRoutes } from './audit.routes';
import { AuditReadService } from './audit.service';

export * from './visibility';
export * from './mapper';
export { viewerOf, AUDIT_VIEW } from './permissions';
export { escapeLike } from './audit.repository';

/** M04 read API (doc 50 section 8). Writing audit rows is lib/audit's job, inside each module's own transaction. */
export function createAuditModule(deps: {
  prisma: ConstructorParameters<typeof AuditRepository>[0];
}): { router: Router } {
  const service = new AuditReadService(new AuditRepository(deps.prisma));
  return { router: createAuditRoutes(createAuditController(service)) };
}
