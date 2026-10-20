import type { RequestHandler } from 'express';
import {
  auditActorSearchQuerySchema,
  auditIdParamsSchema,
  auditListQuerySchema,
  loginHistoryQuerySchema,
} from '@zoauro/shared';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import type { AuditReadService } from './audit.service';

// Parse (shared Zod schema) -> call the service -> send. No rules live here. Read-only: there is no write on audit rows.

export function createAuditController(service: AuditReadService) {
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(auditListQuerySchema, req.query)));
  };
  const detail: RequestHandler = async (req, res) => {
    const { id } = parseBody(auditIdParamsSchema, req.params);
    res.json(await service.detail(authContextOf(res), id));
  };
  const catalogue: RequestHandler = (_req, res) => {
    res.json(service.catalogue());
  };
  const actors: RequestHandler = async (req, res) => {
    res.json(
      await service.searchActors(
        authContextOf(res),
        parseBody(auditActorSearchQuerySchema, req.query),
      ),
    );
  };
  const zones: RequestHandler = async (_req, res) => {
    res.json(await service.zoneOptions(authContextOf(res)));
  };
  const loginHistory: RequestHandler = async (req, res) => {
    res.json(
      await service.loginHistory(authContextOf(res), parseBody(loginHistoryQuerySchema, req.query)),
    );
  };
  const myLoginHistory: RequestHandler = async (_req, res) => {
    res.json(await service.myLoginHistory(authContextOf(res)));
  };
  return { list, detail, catalogue, actors, zones, loginHistory, myLoginHistory };
}
