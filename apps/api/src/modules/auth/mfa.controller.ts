import type { Request, RequestHandler, Response } from 'express';
import {
  memberIdParamsSchema,
  memberMfaResetSchema,
  mfaConfirmSchema,
  mfaPrimarySchema,
  mfaTypeParamsSchema,
  securityPolicyUpdateSchema,
} from '@zoauro/shared';
import { getAuth } from '../../lib/auth/middleware';
import { AppError, parseBody, requestIdOf } from '../../lib/errors';
import { mfaActorOf } from './mfa/actor';
import type { EnrolmentService } from './mfa/enrolment.service';
import type { SecurityPolicyService } from './mfa/policy-admin';

// /me/mfa/* (doc 52 section 8): parse, call the enrolment service, shape the response. No rules live here.

const metaOf = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
  requestId: requestIdOf(res),
});

/** Management routes take a full session only. */
function sessionUser(res: Response) {
  const actor = mfaActorOf(res);
  if (actor.kind !== 'session') throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return actor.user;
}

export function createMfaController(enrolment: EnrolmentService) {
  const overview: RequestHandler = async (_req, res) => {
    res.json(await enrolment.overview(mfaActorOf(res)));
  };
  const emailStart: RequestHandler = async (req, res) => {
    res.json(await enrolment.emailStart(mfaActorOf(res), metaOf(req, res)));
  };
  const emailConfirm: RequestHandler = async (req, res) => {
    const { code } = parseBody(mfaConfirmSchema, req.body);
    res.json(await enrolment.emailConfirm(mfaActorOf(res), code, metaOf(req, res)));
  };
  const authenticatorStart: RequestHandler = async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store'); // the secret is shown once
    res.json(await enrolment.authenticatorStart(mfaActorOf(res)));
  };
  const authenticatorConfirm: RequestHandler = async (req, res) => {
    const { code } = parseBody(mfaConfirmSchema, req.body);
    res.setHeader('Cache-Control', 'no-store'); // backup codes are shown once
    res.json(await enrolment.authenticatorConfirm(mfaActorOf(res), code, metaOf(req, res)));
  };
  const smsStart: RequestHandler = async (req, res) => {
    res.json(await enrolment.smsStart(mfaActorOf(res), metaOf(req, res)));
  };
  const smsConfirm: RequestHandler = async (req, res) => {
    const { code } = parseBody(mfaConfirmSchema, req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await enrolment.smsConfirm(mfaActorOf(res), code, metaOf(req, res)));
  };
  const setPrimary: RequestHandler = async (req, res) => {
    const { type } = parseBody(mfaPrimarySchema, req.body);
    await enrolment.setPrimary(sessionUser(res), type);
    res.status(204).end();
  };
  const removeMethod: RequestHandler = async (req, res) => {
    const { type } = parseBody(mfaTypeParamsSchema, req.params);
    await enrolment.removeMethod(sessionUser(res), type, metaOf(req, res));
    res.status(204).end();
  };
  const regenerateBackupCodes: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ codes: await enrolment.regenerateBackupCodes(sessionUser(res), metaOf(req, res)) });
  };
  /** POST /members/{id}/mfa/reset: Super Admin + STRONG (route guards), reason required */
  const resetMember: RequestHandler = async (req, res) => {
    const { id } = parseBody(memberIdParamsSchema, req.params);
    const { reason } = parseBody(memberMfaResetSchema, req.body);
    const actor = getAuth(res);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    res.json(await enrolment.resetMember(actor.userId, id, reason));
  };

  return {
    resetMember,
    overview,
    emailStart,
    emailConfirm,
    authenticatorStart,
    authenticatorConfirm,
    smsStart,
    smsConfirm,
    setPrimary,
    removeMethod,
    regenerateBackupCodes,
  };
}

/** Settings > Security (doc 52 sections 5 and 8). Super Admin only (settings:* is never grantable). */
export function createSecuritySettingsController(service: SecurityPolicyService) {
  const read: RequestHandler = async (_req, res) => {
    res.json(await service.read());
  };
  const update: RequestHandler = async (req, res) => {
    const { mfa } = parseBody(securityPolicyUpdateSchema, req.body);
    const actor = getAuth(res);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    res.json(await service.update(mfa, actor.userId));
  };
  const status: RequestHandler = async (_req, res) => {
    res.json(await service.status());
  };
  const resumeSms: RequestHandler = async (_req, res) => {
    await service.resumeSms();
    res.status(204).end();
  };
  return { read, update, status, resumeSms };
}
