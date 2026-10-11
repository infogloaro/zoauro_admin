import type { Redis } from 'ioredis';
import { AccessService } from '../../lib/authz';
import { AccessRepository } from './access.repository';

/**
 * Access context for every request (doc 14 section 4). The Access Control module (SA-1.7+) will call
 * invalidateUsers / invalidateProfile / invalidateZone on the returned service after every access change.
 */
export function createAccessService(deps: {
  prisma: ConstructorParameters<typeof AccessRepository>[0];
  redis: Redis;
  /** cache lifetime, clamped to at most 60 seconds */
  cacheTtlSec?: number;
}): AccessService {
  return new AccessService({
    source: new AccessRepository(deps.prisma),
    redis: deps.redis,
    ...(deps.cacheTtlSec === undefined ? {} : { cacheTtlSec: deps.cacheTtlSec }),
  });
}
