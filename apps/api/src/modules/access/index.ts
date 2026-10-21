import type { RequestHandler, Router } from 'express';
import type { Redis } from 'ioredis';
import type { ReauthLevel } from '../../lib/auth/session-store';
import type { GrantSwitches } from '@zoauro/shared';
import { AccessService, type RefundCapsReader } from '../../lib/authz';
import type { ZoneTeamPort } from '../zones';
import { AccessRepository } from './access.repository';
import { createAccessAdminController } from './access-admin.controller';
import { createAccessAdminRoutes } from './access-admin.routes';
import { AccessAdminService } from './access-admin.service';
import { noopAccessMailer, type AccessMailer } from './access.mails';
import { AccessAdminDatabase } from './admin.repository';
import { ClaimsPrismaDatabase } from './claims.repository';
import { registerClaimsRoutes } from './claims.routes';
import { ClaimsService, type ClaimEvent } from './claims.service';
import { registerSuperAdminsRoutes } from './super-admins.routes';
import { SuperAdminsService } from './super-admins.service';

export { createAccessMailer, noopAccessMailer, type AccessMailer } from './access.mails';
export { ADMIN_ZONES_CHANGED, memberScopeEvent } from './access.events';

/**
 * Access context for every request (doc 14 section 4). The Access Control module calls invalidateUsers on it after
 * every access change.
 */
export function createAccessService(deps: {
  prisma: ConstructorParameters<typeof AccessRepository>[0];
  redis: Redis;
  /** cache lifetime, clamped to at most 60 seconds */
  cacheTtlSec?: number;
  /** D110: zone refund caps (settings refunds.limits) that every Zonal Admin's limits are clamped to */
  refundCaps?: RefundCapsReader;
  /** D155: Control Panel switches (settings access.commissionEditGrantable); absent = all off */
  grantSwitches?: () => Promise<GrantSwitches>;
}): AccessService {
  return new AccessService({
    source: new AccessRepository(deps.prisma),
    redis: deps.redis,
    ...(deps.cacheTtlSec === undefined ? {} : { cacheTtlSec: deps.cacheTtlSec }),
    ...(deps.refundCaps ? { refundCaps: deps.refundCaps } : {}),
    ...(deps.grantSwitches ? { grantSwitches: deps.grantSwitches } : {}),
  });
}

/**
 * The zone team read by the zones module (list avatars, zones without a team, GET /zones/{id}/team): real data from
 * the assignments, no longer a stub (M03).
 */
export function createZoneTeamPort(
  prisma: ConstructorParameters<typeof AccessAdminDatabase>[0],
): ZoneTeamPort {
  const db = new AccessAdminDatabase(prisma);
  const service = new AccessAdminService({
    db,
    access: { invalidateUsers: async () => undefined },
    evictSessions: async () => undefined,
    mailer: noopAccessMailer,
    clock: () => new Date(),
  });
  return {
    stub: false,
    members: (ctx, zoneId) => service.team(ctx, zoneId),
    summaries: (ctx, zoneIds) => db.repo.teamSummaries(ctx, zoneIds),
  };
}

/** M03 Access Control (doc 09, D102–D108): members, their access, zone teams, access profiles and the change history. */
export function createAccessModule(deps: {
  prisma: ConstructorParameters<typeof AccessAdminDatabase>[0];
  /** the request-time access service: its cache is cleared after every change (D107) */
  access: AccessService;
  appOrigin: string;
  /** the auth module's step-up guard */
  requireReauth: (level: ReauthLevel) => RequestHandler;
  /** the auth module's session cache eviction (sessions ended by suspend, delete, reset, revoke) */
  evictSessions: (tokenHashes: string[]) => Promise<void>;
  mailer?: AccessMailer;
  clock?: () => Date;
  /** D110: zone refund caps (the settings module's reader) */
  refundCaps?: RefundCapsReader;
  /** D155: the same switches the access service reads */
  grantSwitches?: () => Promise<GrantSwitches>;
  /** D174: settings claims.timing (absent: 30 min claims, 10 min takeover requests) */
  claimTiming?: () => Promise<{ ttlMinutes: number; takeoverTimeoutMinutes: number }>;
  /** D174: realtime / notifications for takeover and override events (optional) */
  onClaimEvent?: (e: ClaimEvent) => void;
}): { router: Router; service: AccessAdminService; claims: ClaimsService } {
  const db = new AccessAdminDatabase(deps.prisma);
  const service = new AccessAdminService({
    db,
    access: deps.access,
    evictSessions: deps.evictSessions,
    mailer: deps.mailer ?? noopAccessMailer,
    clock: deps.clock ?? (() => new Date()),
    ...(deps.refundCaps ? { refundCaps: deps.refundCaps } : {}),
    ...(deps.grantSwitches ? { grantSwitches: deps.grantSwitches } : {}),
  });
  const routeOpts = { appOrigin: deps.appOrigin, requireReauth: deps.requireReauth };
  const router = createAccessAdminRoutes(createAccessAdminController(service), routeOpts);
  // D148: Super Admins, on the same router (the route list and the authorization matrix read its stack)
  registerSuperAdminsRoutes(
    router,
    new SuperAdminsService({
      db,
      evictSessions: deps.evictSessions,
      mailer: deps.mailer ?? noopAccessMailer,
      clock: deps.clock ?? (() => new Date()),
    }),
    routeOpts,
  );
  // D174: record claims; `claims.assertNotClaimedByOther` is for the record modules' write services
  const claims = new ClaimsService({
    db: new ClaimsPrismaDatabase(deps.prisma),
    clock: deps.clock ?? (() => new Date()),
    timing: deps.claimTiming ?? (async () => ({ ttlMinutes: 30, takeoverTimeoutMinutes: 10 })),
    ...(deps.onClaimEvent ? { onEvent: deps.onClaimEvent } : {}),
  });
  registerClaimsRoutes(router, claims, routeOpts);
  return { router, service, claims };
}
