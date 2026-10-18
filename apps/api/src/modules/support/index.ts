import type { AccessService } from '../../lib/authz';
import { SupportDatabase } from './support.repository';
import { createSupportRoutes } from './support.routes';
import { SupportService } from './support.service';
import type { SupportSla } from './support.rules';

// Support desk (doc 57 workstream 8; D93, D98, D139-D141). The API mounts the routes; the worker runs the SLA sweep.

export { SupportService, TICKET_CHANGED } from './support.service';
export { startSupportJobs, SUPPORT_QUEUE } from './support.jobs';
export type { SupportSla } from './support.rules';

/** support:edit in the zone from the access tables (profile + overrides, deny wins; <= 60 s cache). */
export function canEditViaAccess(access: Pick<AccessService, 'resolve'>) {
  return async (userId: string, zoneId: string): Promise<boolean> =>
    (await access.resolve(userId)).permissions[zoneId]?.includes('support:edit') ?? false;
}

type SupportDeps = {
  prisma: ConstructorParameters<typeof SupportDatabase>[0];
  /** settings support.sla for a zone (SettingsReader, D98) */
  slaOf: (zoneId: string) => Promise<SupportSla>;
  access: Pick<AccessService, 'resolve'>;
  clock?: () => Date;
};

/** The service alone (worker: the sweep). */
export function createSupportService(deps: SupportDeps): SupportService {
  return new SupportService({
    db: new SupportDatabase(deps.prisma),
    slaOf: deps.slaOf,
    canEditIn: canEditViaAccess(deps.access),
    clock: deps.clock ?? (() => new Date()),
  });
}

/** Service + routes (API). */
export function createSupportModule(deps: SupportDeps & { appOrigin: string }) {
  const service = createSupportService(deps);
  return { router: createSupportRoutes(service, { appOrigin: deps.appOrigin }), service };
}
