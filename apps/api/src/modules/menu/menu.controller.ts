import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  listMenuItemChangeRequestsQuerySchema,
  listMenuItemsQuerySchema,
  menuItemApprovalSchema,
  menuItemBulkPreviewSchema,
  menuItemBulkSchema,
  menuItemChangeApproveSchema,
  menuItemChangeRejectSchema,
  menuItemCreateSchema,
  menuItemImportSchema,
  menuItemUpdateSchema,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './menu.service';
import * as service from './menu.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function itemId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Menu item not found');
  return id;
}

/** Same 404-not-422 rule for the nested change-request routes. */
function changeRequestId(req: Request): string {
  const raw = req.params.crId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Change request not found');
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const menuHandlers = {
  list: (async (req, res, next) => {
    try {
      const query = listMenuItemsQuerySchema.parse(req.query);
      res.json(await service.listMenuItems(query));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  menus: (async (_req, res, next) => {
    try {
      res.json(await service.getMenuAggregate());
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  create: (async (req, res, next) => {
    try {
      const input = menuItemCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createMenuItem(actor(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  get: (async (req, res, next) => {
    try {
      res.json({ data: await service.getMenuItem(itemId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  patch: (async (req, res, next) => {
    try {
      const input = menuItemUpdateSchema.parse(req.body);
      res.json({ data: await service.updateMenuItem(actor(req), itemId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  remove: (async (req, res, next) => {
    try {
      res.json({ data: await service.removeMenuItem(actor(req), itemId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  approval: (async (req, res, next) => {
    try {
      const input = menuItemApprovalSchema.parse(req.body);
      res.json({ data: await service.setMenuItemApproval(actor(req), itemId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  bulk: (async (req, res, next) => {
    try {
      const input = menuItemBulkSchema.parse(req.body);
      res.json({ data: await service.bulkMenuAction(actor(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  /** D124 dry run: same validation and id resolution, zero writes. */
  bulkPreview: (async (req, res, next) => {
    try {
      const input = menuItemBulkPreviewSchema.parse(req.body);
      res.json(await service.bulkMenuPreview(input));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  /** R09: vendor item-change requests, default status PENDING (doc 09). */
  changeRequests: (async (req, res, next) => {
    try {
      const query = listMenuItemChangeRequestsQuerySchema.parse(req.query);
      res.json(await service.listMenuItemChangeRequests(query));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  changeRequest: (async (req, res, next) => {
    try {
      res.json({ data: await service.getMenuItemChangeRequest(changeRequestId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  changeRequestApprove: (async (req, res, next) => {
    try {
      const input = menuItemChangeApproveSchema.parse(req.body);
      const data = await service.decideMenuItemChangeRequest(actor(req), changeRequestId(req), {
        ...input,
        decision: 'APPROVED',
      });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  changeRequestReject: (async (req, res, next) => {
    try {
      const input = menuItemChangeRejectSchema.parse(req.body);
      const data = await service.decideMenuItemChangeRequest(actor(req), changeRequestId(req), {
        ...input,
        decision: 'REJECTED',
      });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  /** A6: dry-run report or transactional CSV import (doc 34 SA-2.5). */
  importItems: (async (req, res, next) => {
    try {
      const input = menuItemImportSchema.parse(req.body);
      res.json({ data: await service.importMenuItems(actor(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,
};
