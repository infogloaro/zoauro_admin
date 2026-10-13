import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

function zodDetails(error: ZodError): { field?: string; issue: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : undefined,
    issue: issue.message,
  }));
}

/** Converts thrown errors to the doc 09 error envelope. Never leaks stacks or SQL. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  const requestId = req.requestId ?? 'unknown';

  if (error instanceof AppError) {
    if (error.httpStatus >= 500) {
      logger.error({ requestId, code: error.code, message: error.message }, 'request failed');
    }
    res.status(error.httpStatus).json({
      error: { code: error.code, message: error.message, details: error.details, requestId },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: zodDetails(error),
        requestId,
      },
    });
    return;
  }

  logger.error({ requestId, err: error }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong', requestId },
  });
}

/** JSON 404 for unknown API routes. */
export function apiNotFound(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  });
}
