import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { listZonesQuerySchema, zoneCreateSchema, zoneUpdateSchema } from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './zones.service';
import * as zonesService from './zones.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function zoneId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Zone not found');
  return id;
}

export async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = listZonesQuerySchema.parse(req.query);
    res.json(await zonesService.listZones(query));
  } catch (error) {
    next(error);
  }
}

export async function createHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = zoneCreateSchema.parse(req.body);
    const zone = await zonesService.createZone(actor(req), input);
    res.status(201).json({ data: zone });
  } catch (error) {
    next(error);
  }
}

export async function getHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const zone = await zonesService.getZone(zoneId(req));
    res.json({ data: zone });
  } catch (error) {
    next(error);
  }
}

export async function updateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = zoneUpdateSchema.parse(req.body);
    const zone = await zonesService.updateZone(actor(req), zoneId(req), input);
    res.json({ data: zone });
  } catch (error) {
    next(error);
  }
}

export async function removeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const zone = await zonesService.deactivateZone(actor(req), zoneId(req));
    res.json({ data: zone });
  } catch (error) {
    next(error);
  }
}

export async function impactHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = zoneId(req);
    const existing = await zonesService.getZone(id); // 404s for missing zones
    const impact = await zonesService.getImpact(existing.id);
    res.json({ data: impact });
  } catch (error) {
    next(error);
  }
}
