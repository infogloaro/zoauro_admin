import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  homemakerCreateSchema,
  homemakerUpdateSchema,
  listVendorsQuerySchema,
  onboardingChecklistInputSchema,
  restaurantCreateSchema,
  restaurantUpdateSchema,
  setReviewDeadlineSchema,
  vendorBulkStatusSchema,
  vendorDocumentUploadSchema,
  vendorDocumentVerifySchema,
  vendorMoveZoneSchema,
  vendorStatusSchema,
  vendorVerificationSchema,
  type VendorKind,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import * as onboarding from './vendor.onboarding';
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

/** Optional zone filter shared by the A1 reminders/review-queue endpoints. */
const zoneFilterSchema = z.object({
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
});

function zoneIdsOf(query: { zoneId?: string | string[] }): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/** One controller per vendor kind; the schemas differ, the flow does not (doc 09). */
export function createVendorHandlers(kind: VendorKind): {
  list: Handler;
  exportCsv: Handler;
  bulk: Handler;
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
  getChecklist: Handler;
  updateChecklist: Handler;
  getOnboarding: Handler;
  reviewDeadline: Handler;
  reviewQueue: Handler;
  sendReminders: Handler;
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

  /** GET /{module}/export — filtered CSV (doc 22, doc 13 T15/T16), audited. */
  const exportCsv: Handler = async (req, res, next) => {
    try {
      const query = listVendorsQuerySchema.parse(req.query);
      const { filename, csv } = await service.exportVendorsCsv(actor(req), kind, query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  };

  /** POST /{module}/bulk — bulk status change with partial-failure counts. */
  const bulk: Handler = async (req, res, next) => {
    try {
      const input = vendorBulkStatusSchema.parse(req.body);
      res.json({ data: await service.bulkChangeVendorStatus(actor(req), kind, input) });
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
      res.json({ data: await service.getVendorDetail(actor(req), kind, vendorId(req)) });
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

  /* A1 onboarding (doc 09 checklist/onboarding/review-deadline/reminders) */

  const getChecklist: Handler = async (req, res, next) => {
    try {
      res.json({ data: await onboarding.getOnboardingChecklist(kind) });
    } catch (error) {
      next(error);
    }
  };

  const updateChecklist: Handler = async (req, res, next) => {
    try {
      const input = onboardingChecklistInputSchema.parse(req.body);
      res.json({ data: await onboarding.updateOnboardingChecklist(actor(req), kind, input) });
    } catch (error) {
      next(error);
    }
  };

  const getOnboarding: Handler = async (req, res, next) => {
    try {
      res.json({ data: await onboarding.getVendorOnboarding(kind, vendorId(req)) });
    } catch (error) {
      next(error);
    }
  };

  const reviewDeadline: Handler = async (req, res, next) => {
    try {
      const input = setReviewDeadlineSchema.parse(req.body);
      res.json({
        data: await onboarding.setVendorReviewDeadline(actor(req), kind, vendorId(req), input),
      });
    } catch (error) {
      next(error);
    }
  };

  const reviewQueue: Handler = async (req, res, next) => {
    try {
      const query = zoneFilterSchema.parse(req.query);
      const zoneIds = await service.resolveZoneScope(zoneIdsOf(query));
      res.json({ data: await onboarding.listReviewQueue(kind, zoneIds) });
    } catch (error) {
      next(error);
    }
  };

  const sendReminders: Handler = async (req, res, next) => {
    try {
      const query = zoneFilterSchema.parse(req.query);
      const zoneIds = await service.resolveZoneScope(zoneIdsOf(query));
      res.json({ data: await onboarding.sendOnboardingReminders(actor(req), kind, zoneIds) });
    } catch (error) {
      next(error);
    }
  };

  return {
    list,
    exportCsv,
    bulk,
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
    getChecklist,
    updateChecklist,
    getOnboarding,
    reviewDeadline,
    reviewQueue,
    sendReminders,
  };
}
