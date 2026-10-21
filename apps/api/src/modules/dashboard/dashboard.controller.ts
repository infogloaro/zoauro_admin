import type { NextFunction, Request, Response } from 'express';
import { listDashboardQuerySchema, newRegistrationsQuerySchema } from '@zoauro/shared';
import * as service from './dashboard.service';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const dashboardHandlers: {
  summary: Handler;
  newRegistrations: Handler;
} = {
  summary: async (req, res, next) => {
    try {
      const query = listDashboardQuerySchema.parse(req.query);
      res.json(await service.getSummary(query));
    } catch (error) {
      next(error);
    }
  },

  newRegistrations: async (req, res, next) => {
    try {
      const query = newRegistrationsQuerySchema.parse(req.query);
      res.json(await service.getNewRegistrations(query));
    } catch (error) {
      next(error);
    }
  },
};
