import type { NextFunction, Request, Response } from 'express';
import { OrderService, OrderServiceError } from './service';

import type { OrderActor } from './types';

interface AuthenticatedRequest extends Request {
  auth?: OrderActor;
}

export const createOrderController = (service: OrderService) => ({
  list: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.listOrders(req.query);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  dashboard: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;

      const data = await service.getDashboard(from, to);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  transition: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const actor = authReq.auth;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      if (!actor) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Order ID is required',
        });
        return;
      }

      const data = await service.transitionOrder(id, req.body, actor);
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof OrderServiceError) {
        res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
        return;
      }

      next(error);
    }
  },
});
