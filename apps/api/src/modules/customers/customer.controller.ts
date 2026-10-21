import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  customerCreateSchema,
  customerUpdateSchema,
  listCustomersQuerySchema,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './customer.service';
import * as service from './customer.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function customerId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Customer not found');
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const customerHandlers: {
  list: Handler;
  create: Handler;
  get: Handler;
  patch: Handler;
  block: Handler;
  unblock: Handler;
  reveal: Handler;
} = {
  list: async (req, res, next) => {
    try {
      const query = listCustomersQuerySchema.parse(req.query);
      res.json(await service.listCustomers(query));
    } catch (error) {
      next(error);
    }
  },

  create: async (req, res, next) => {
    try {
      const input = customerCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createCustomer(actor(req), input) });
    } catch (error) {
      next(error);
    }
  },

  get: async (req, res, next) => {
    try {
      res.json({ data: await service.getCustomerDetail(customerId(req)) });
    } catch (error) {
      next(error);
    }
  },

  patch: async (req, res, next) => {
    try {
      const input = customerUpdateSchema.parse(req.body);
      res.json({ data: await service.updateCustomer(actor(req), customerId(req), input) });
    } catch (error) {
      next(error);
    }
  },

  block: async (req, res, next) => {
    try {
      res.json({ data: await service.setCustomerBlocked(actor(req), customerId(req), true) });
    } catch (error) {
      next(error);
    }
  },

  unblock: async (req, res, next) => {
    try {
      res.json({ data: await service.setCustomerBlocked(actor(req), customerId(req), false) });
    } catch (error) {
      next(error);
    }
  },

  reveal: async (req, res, next) => {
    try {
      res.json({ data: await service.revealCustomer(actor(req), customerId(req)) });
    } catch (error) {
      next(error);
    }
  },
};
