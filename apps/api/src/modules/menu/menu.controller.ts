import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  listMenuItemsQuerySchema,
  menuItemApprovalSchema,
  menuItemBulkSchema,
  menuItemCreateSchema,
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
};
