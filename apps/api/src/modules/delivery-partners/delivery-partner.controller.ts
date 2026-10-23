import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  deliveryPartnerCreateSchema,
  deliveryPartnerForceOfflineSchema,
  deliveryPartnerMoveZoneSchema,
  deliveryPartnerStatusSchema,
  deliveryPartnerUpdateSchema,
  deliveryPartnerVerificationSchema,
  listDeliveryPartnersQuerySchema,
  vendorDocumentUploadSchema,
  vendorDocumentVerifySchema,
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

function documentId(req: Request): string {
  const raw = req.params.documentId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Document not found');
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const deliveryPartnerHandlers: {
  list: Handler;
  create: Handler;
  get: Handler;
  patch: Handler;
  remove: Handler;
  status: Handler;
  verification: Handler;
  forceOffline: Handler;
  reveal: Handler;
  moveZone: Handler;
  addDocument: Handler;
  documentUrl: Handler;
  verifyDocument: Handler;
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

  get: async (req, res, next) => {
    try {
      res.json({ data: await service.getDeliveryPartnerDetail(partnerId(req)) });
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

  remove: async (req, res, next) => {
    try {
      res.json({ data: await service.removeDeliveryPartner(actor(req), partnerId(req)) });
    } catch (error) {
      next(error);
    }
  },

  status: async (req, res, next) => {
    try {
      const input = deliveryPartnerStatusSchema.parse(req.body);
      res.json({
        data: await service.changeDeliveryPartnerStatus(actor(req), partnerId(req), input),
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

  reveal: async (req, res, next) => {
    try {
      res.json({ data: await service.revealDeliveryPartner(actor(req), partnerId(req)) });
    } catch (error) {
      next(error);
    }
  },

  moveZone: async (req, res, next) => {
    try {
      const input = deliveryPartnerMoveZoneSchema.parse(req.body);
      res.json({ data: await service.moveDeliveryPartnerZone(actor(req), partnerId(req), input) });
    } catch (error) {
      next(error);
    }
  },

  addDocument: async (req, res, next) => {
    try {
      const input = vendorDocumentUploadSchema.parse(req.body);
      res.status(201).json({
        data: await service.addDeliveryPartnerDocument(actor(req), partnerId(req), input),
      });
    } catch (error) {
      next(error);
    }
  },

  documentUrl: async (req, res, next) => {
    try {
      res.json({
        data: await service.getDeliveryPartnerDocumentUrl(
          actor(req),
          partnerId(req),
          documentId(req),
        ),
      });
    } catch (error) {
      next(error);
    }
  },

  verifyDocument: async (req, res, next) => {
    try {
      const input = vendorDocumentVerifySchema.parse(req.body);
      res.json({
        data: await service.setDeliveryPartnerDocumentVerification(
          actor(req),
          partnerId(req),
          documentId(req),
          input,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
};
