import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  listThirdPartyProvidersQuerySchema,
  thirdPartyProviderCreateSchema,
  thirdPartyProviderStatusSchema,
  thirdPartyProviderUpdateSchema,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './third-party-provider.service';
import * as service from './third-party-provider.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function providerId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) {
    throw errors.notFound('Third-party provider not found');
  }
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const thirdPartyProviderHandlers: {
  list: Handler;
  create: Handler;
  patch: Handler;
  status: Handler;
} = {
  list: async (req, res, next) => {
    try {
      const query = listThirdPartyProvidersQuerySchema.parse(req.query);
      res.json(await service.listThirdPartyProviders(query));
    } catch (error) {
      next(error);
    }
  },

  create: async (req, res, next) => {
    try {
      const input = thirdPartyProviderCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createThirdPartyProvider(actor(req), input) });
    } catch (error) {
      next(error);
    }
  },

  patch: async (req, res, next) => {
    try {
      const input = thirdPartyProviderUpdateSchema.parse(req.body);
      res.json({
        data: await service.updateThirdPartyProvider(actor(req), providerId(req), input),
      });
    } catch (error) {
      next(error);
    }
  },

  status: async (req, res, next) => {
    try {
      const input = thirdPartyProviderStatusSchema.parse(req.body);
      res.json({
        data: await service.setThirdPartyProviderStatus(actor(req), providerId(req), input),
      });
    } catch (error) {
      next(error);
    }
  },
};
