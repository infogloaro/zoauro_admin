import type { RequestHandler } from 'express';
import type { z } from 'zod';
import {
  activateZoneSchema,
  createZoneSchema,
  deactivateZoneSchema,
  DEACTIVATION_REASON,
  patchZoneSchema,
  zoneDetailQuerySchema,
  zoneIdParamsSchema,
  zoneListQuerySchema,
  zoneLookupQuerySchema,
  zonePincodesQuerySchema,
  zonePincodesSchema,
  putZoneServicesSchema,
} from '@zoauro/shared';
import { authContextOf } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import type { ZonesService } from './zones.service';

// Parse (shared Zod schema) -> call the service -> send. No rules live here.

/**
 * Like parseBody, with the zone codes doc 53 names: a range over 2000 pincodes is RANGE_TOO_LARGE (not a generic
 * validation error), and custom issues carry their message (e.g. RANGE_TOO_LARGE) instead of "custom".
 */
function parseZoneBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({
    field: i.path.join('.') || 'body',
    issue: i.code === 'custom' ? i.message : i.code,
  }));
  if (details.some((d) => d.issue === 'RANGE_TOO_LARGE'))
    throw new AppError('RANGE_TOO_LARGE', 'A range may hold at most 2000 pincodes', details);
  throw new AppError('VALIDATION_ERROR', 'Invalid input', details);
}

const hasKey = (body: unknown, key: string): boolean =>
  typeof body === 'object' && body !== null && Object.prototype.hasOwnProperty.call(body, key);

export function createZonesController(service: ZonesService) {
  const id = (params: unknown) => parseBody(zoneIdParamsSchema, params).id;

  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(zoneListQuerySchema, req.query)));
  };
  const summary: RequestHandler = async (_req, res) => {
    res.json(await service.summary(authContextOf(res)));
  };
  const detail: RequestHandler = async (req, res) => {
    res.json(
      await service.detail(
        authContextOf(res),
        id(req.params),
        parseBody(zoneDetailQuerySchema, req.query),
      ),
    );
  };
  const lookup: RequestHandler = async (req, res) => {
    const { pincode } = parseBody(zoneLookupQuerySchema, req.query);
    res.json(await service.lookup(authContextOf(res), pincode));
  };
  const impact: RequestHandler = async (req, res) => {
    res.json(await service.impact(authContextOf(res), id(req.params)));
  };
  const services: RequestHandler = async (req, res) => {
    res.json(await service.services(authContextOf(res), id(req.params)));
  };
  const putServices: RequestHandler = async (req, res) => {
    res.json(
      await service.putServices(
        authContextOf(res),
        id(req.params),
        parseBody(putZoneServicesSchema, req.body),
      ),
    );
  };
  const team: RequestHandler = async (req, res) => {
    res.json(await service.team(authContextOf(res), id(req.params)));
  };

  const create: RequestHandler = async (req, res) => {
    res
      .status(201)
      .json(await service.create(authContextOf(res), parseZoneBody(createZoneSchema, req.body)));
  };
  const patch: RequestHandler = async (req, res) => {
    const zoneId = id(req.params);
    // R-ZONE-3: the code appears in order numbers and exports and never changes (TC-ZONE-12)
    if (hasKey(req.body, 'code'))
      throw new AppError('CODE_IMMUTABLE', 'The zone code cannot be changed', [
        { field: 'code', issue: 'CODE_IMMUTABLE' },
      ]);
    res.json(
      await service.patch(authContextOf(res), zoneId, parseZoneBody(patchZoneSchema, req.body)),
    );
  };
  const pincodes: RequestHandler = async (req, res) => {
    const zoneId = id(req.params);
    const { preview } = parseBody(zonePincodesQuerySchema, req.query);
    res.json(
      await service.pincodes(
        authContextOf(res),
        zoneId,
        parseZoneBody(zonePincodesSchema, req.body),
        preview,
      ),
    );
  };
  const activate: RequestHandler = async (req, res) => {
    const zoneId = id(req.params);
    const { version } = parseZoneBody(activateZoneSchema, req.body);
    res.json(await service.activate(authContextOf(res), zoneId, version));
  };
  const deactivate: RequestHandler = async (req, res) => {
    const zoneId = id(req.params);
    const body: unknown = req.body;
    const reason =
      typeof body === 'object' && body !== null ? (body as { reason?: unknown }).reason : undefined;
    // doc 53 section 5: a missing or too short reason has its own code (the dialog asks for at least 10 characters)
    if (typeof reason !== 'string' || reason.trim().length < DEACTIVATION_REASON.min)
      throw new AppError(
        'REASON_REQUIRED',
        `Give a reason of at least ${DEACTIVATION_REASON.min} characters`,
        [{ field: 'reason', issue: 'REASON_REQUIRED' }],
      );
    res.json(
      await service.deactivate(
        authContextOf(res),
        zoneId,
        parseZoneBody(deactivateZoneSchema, body),
      ),
    );
  };
  const remove: RequestHandler = async (req, res) => {
    await service.remove(authContextOf(res), id(req.params));
    res.status(204).end();
  };

  return {
    list,
    summary,
    detail,
    lookup,
    impact,
    team,
    services,
    putServices,
    create,
    patch,
    pincodes,
    activate,
    deactivate,
    remove,
  };
}
