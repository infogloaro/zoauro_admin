import {
  intakePartnerRegisterSchema,
  intakeVendorRegisterSchema,
  intakeZoneResolveQuerySchema,
  type IntakePing,
} from '@zoauro/shared';
import { Router } from 'express';
import type { Clock } from '../../lib/auth/config';
import { AppError, parseBody } from '../../lib/errors';
import { IdempotencyRepository } from '../../lib/idempotency';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { SecretBox } from '../auth/mfa/secret-box';
import { RESOLVE_SCOPE, type ZoneResolver } from '../zones';
import { IntakeRepository } from './intake.repository';
import {
  appAuditContext,
  authenticateClient,
  inboundLog,
  intakeClientOf,
  noteIntakeEntity,
  requireScope,
  writeIdempotency,
} from './intake.middleware';
import { RegistrationsDatabase } from './registrations.repository';
import { RegistrationsService } from './registrations.service';

// Integration API (M21, D147; doc 42, contract docs/G-integration/contracts/intake.openapi.yaml). Server-to-server from
// the customer, vendor and partner app backends: HMAC-signed, scoped per client, Idempotency-Key on writes. Mounted by
// createApp's `raw` hook at INTAKE_PATH, outside the staff session stack.

export const INTAKE_PATH = '/api/v1/intake';

export { apiClientSecretAad, type IntakeClient } from './intake.middleware';
export { canonicalString, sign } from './signature';

export function createIntakeModule(deps: {
  /** the Prisma client (transactions for sign-ups) */
  prisma: ConstructorParameters<typeof RegistrationsDatabase>[0];
  secretBox: SecretBox;
  limiter: RateLimiter;
  resolver: ZoneResolver;
  clock: Clock;
}): { path: string; router: Router } {
  const repo = () => new IntakeRepository(deps.prisma);
  const router = Router();
  router.use(
    inboundLog({ repo, clock: deps.clock }),
    authenticateClient({
      repo,
      secretBox: deps.secretBox,
      limiter: deps.limiter,
      clock: deps.clock,
    }),
    writeIdempotency({ store: new IdempotencyRepository(deps.prisma), clock: deps.clock }),
    appAuditContext(),
  );
  const registrations = new RegistrationsService(new RegistrationsDatabase(deps.prisma));

  // doc 42 section 5.1: connectivity and clock check, any scope
  router.get('/ping', (_req, res) => {
    const client = intakeClientOf(res);
    const data: IntakePing = {
      serverTime: deps.clock().toISOString(),
      client: client.name,
      environment: client.environment,
    };
    res.json({ data });
  });

  router.get('/zones/resolve', requireScope(RESOLVE_SCOPE), async (req, res) => {
    const client = intakeClientOf(res);
    const q = parseBody(intakeZoneResolveQuerySchema, req.query);
    res.json({
      data: await deps.resolver.resolve({ clientId: client.id, scopes: client.scopes }, q),
    });
  });

  // doc 42 sections 5.3 and 5.4 (IH-2): self-registration; 201 in a zone, 202 waiting for one, 200 already registered
  router.post('/vendors', requireScope('vendors:register'), async (req, res) => {
    const input = parseBody(intakeVendorRegisterSchema, req.body);
    const r = await registrations.registerVendor(intakeClientOf(res), input, deps.clock());
    noteIntakeEntity(res, { type: r.entity, id: r.ref.id, zoneId: r.zoneId });
    res.status(r.httpStatus).json({ data: r.ref });
  });

  router.post('/partners', requireScope('partners:register'), async (req, res) => {
    const input = parseBody(intakePartnerRegisterSchema, req.body);
    const r = await registrations.registerPartner(intakeClientOf(res), input, deps.clock());
    noteIntakeEntity(res, { type: 'partner', id: r.ref.id, zoneId: r.zoneId });
    res.status(r.httpStatus).json({ data: r.ref });
  });

  // An unknown intake path ends here, never in the staff API mounted behind it.
  router.use(() => {
    throw new AppError('NOT_FOUND', 'No such Integration API route');
  });
  return { path: INTAKE_PATH, router };
}
