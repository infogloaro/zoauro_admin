import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  deliveryPartnerCreateSchema,
  deliveryPartnerForceOfflineSchema,
  deliveryPartnerUpdateSchema,
  deliveryPartnerVerificationSchema,
  listDeliveryPartnersQuerySchema,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './delivery-partner.service';
import * as service from './delivery-partner.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function partnerId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Delivery partner not found');
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const deliveryPartnerHandlers: {
  list: Handler;
  create: Handler;
  patch: Handler;
  verification: Handler;
  forceOffline: Handler;
} = {
  list: async (req, res, next) => {
    try {
      const query = listDeliveryPartnersQuerySchema.parse(req.query);
      res.json(await service.listDeliveryPartners(query));
    } catch (error) {
      next(error);
    }
  },

  create: async (req, res, next) => {
    try {
      const input = deliveryPartnerCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createDeliveryPartner(actor(req), input) });
    } catch (error) {
      next(error);
    }
  },

  patch: async (req, res, next) => {
    try {
      const input = deliveryPartnerUpdateSchema.parse(req.body);
      res.json({
        data: await service.updateDeliveryPartner(actor(req), partnerId(req), input),
      });
    } catch (error) {
      next(error);
    }
  },

  verification: async (req, res, next) => {
    try {
      const input = deliveryPartnerVerificationSchema.parse(req.body);
      res.json({
        data: await service.setDeliveryPartnerVerification(actor(req), partnerId(req), input),
      });
    } catch (error) {
      next(error);
    }
  },

  forceOffline: async (req, res, next) => {
    try {
      const input = deliveryPartnerForceOfflineSchema.parse(req.body);
      res.json({
        data: await service.forceDeliveryPartnerOffline(actor(req), partnerId(req), input),
      });
    } catch (error) {
      next(error);
    }
  },
};
