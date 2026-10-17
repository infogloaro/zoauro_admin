import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  homemakerCreateSchema,
  homemakerUpdateSchema,
  listVendorsQuerySchema,
  restaurantCreateSchema,
  restaurantUpdateSchema,
  vendorDocumentUploadSchema,
  vendorDocumentVerifySchema,
  vendorMoveZoneSchema,
  vendorStatusSchema,
  vendorVerificationSchema,
  type VendorKind,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './vendor.service';
import * as service from './vendor.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function vendorId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Vendor not found');
  return id;
}

function documentId(req: Request): string {
  const raw = req.params.documentId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Document not found');
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** One controller per vendor kind; the schemas differ, the flow does not (doc 09). */
export function createVendorHandlers(kind: VendorKind): {
  list: Handler;
  create: Handler;
  get: Handler;
  patch: Handler;
  remove: Handler;
  status: Handler;
  verification: Handler;
  moveZone: Handler;
  addDocument: Handler;
  documentUrl: Handler;
  verifyDocument: Handler;
} {
  const createSchema = kind === 'restaurant' ? restaurantCreateSchema : homemakerCreateSchema;
  const updateSchema = kind === 'restaurant' ? restaurantUpdateSchema : homemakerUpdateSchema;

  const list: Handler = async (req, res, next) => {
    try {
      const query = listVendorsQuerySchema.parse(req.query);
      res.json(await service.listVendors(kind, query));
    } catch (error) {
      next(error);
    }
  };

  const create: Handler = async (req, res, next) => {
    try {
      const input = createSchema.parse(req.body);
      const vendor = await service.createVendor(actor(req), kind, input);
      res.status(201).json({ data: vendor });
    } catch (error) {
      next(error);
    }
  };

  const get: Handler = async (req, res, next) => {
    try {
      res.json({ data: await service.getVendorDetail(kind, vendorId(req)) });
    } catch (error) {
      next(error);
    }
  };

  const patch: Handler = async (req, res, next) => {
    try {
      const input = updateSchema.parse(req.body);
      res.json({ data: await service.updateVendor(actor(req), kind, vendorId(req), input) });
    } catch (error) {
      next(error);
    }
  };

  const remove: Handler = async (req, res, next) => {
    try {
      res.json({ data: await service.removeVendor(actor(req), kind, vendorId(req)) });
    } catch (error) {
      next(error);
    }
  };

  const status: Handler = async (req, res, next) => {
    try {
      const input = vendorStatusSchema.parse(req.body);
      res.json({ data: await service.changeVendorStatus(actor(req), kind, vendorId(req), input) });
    } catch (error) {
      next(error);
    }
  };

  const verification: Handler = async (req, res, next) => {
    try {
      const input = vendorVerificationSchema.parse(req.body);
      res.json({
        data: await service.setVendorVerification(actor(req), kind, vendorId(req), input),
      });
    } catch (error) {
      next(error);
    }
  };

  const moveZone: Handler = async (req, res, next) => {
    try {
      const { zoneId } = vendorMoveZoneSchema.parse(req.body);
      res.json({ data: await service.moveVendorZone(actor(req), kind, vendorId(req), zoneId) });
    } catch (error) {
      next(error);
    }
  };

  const addDocument: Handler = async (req, res, next) => {
    try {
      const input = vendorDocumentUploadSchema.parse(req.body);
      res
        .status(201)
        .json({ data: await service.addVendorDocument(actor(req), kind, vendorId(req), input) });
    } catch (error) {
      next(error);
    }
  };

  const documentUrl: Handler = async (req, res, next) => {
    try {
      res.json({
        data: await service.getVendorDocumentUrl(actor(req), kind, vendorId(req), documentId(req)),
      });
    } catch (error) {
      next(error);
    }
  };

  const verifyDocument: Handler = async (req, res, next) => {
    try {
      const input = vendorDocumentVerifySchema.parse(req.body);
      res.json({
        data: await service.setVendorDocumentVerification(
          actor(req),
          kind,
          vendorId(req),
          documentId(req),
          input,
        ),
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    list,
    create,
    get,
    patch,
    remove,
    status,
    verification,
    moveZone,
    addDocument,
    documentUrl,
    verifyDocument,
  };
}
