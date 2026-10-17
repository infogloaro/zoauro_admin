import type { NextFunction, Request, Response } from 'express';
import { uploadConfirmSchema, uploadPresignSchema } from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../lib/auth-context';
import * as service from './uploads.service';

function actor(req: Request): AuthContext {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth;
}

/** POST /uploads/presign (doc 09): allow-listed type/size → signed PUT URL. */
export async function presignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = uploadPresignSchema.parse(req.body);
    res.json({ data: await service.presignUpload(actor(req), input) });
  } catch (error) {
    next(error);
  }
}

/** POST /uploads/confirm (doc 09): the object exists and passes the checks. */
export async function confirmHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = uploadConfirmSchema.parse(req.body);
    res.json({ data: await service.confirmUpload(actor(req), input) });
  } catch (error) {
    next(error);
  }
}
