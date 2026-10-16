import type { RequestHandler } from 'express';
import {
  accessChangeListQuerySchema,
  accessPreviewQuerySchema,
  accessProfileIdParamsSchema,
  addTeamMemberSchema,
  createAccessProfileSchema,
  createZonalAdminSchema,
  putAccessProfilePermissionsSchema,
  putMemberAccessSchema,
  resetZonalAdminPasswordSchema,
  updateAccessProfileSchema,
  updateZonalAdminSchema,
  zonalAdminIdParamsSchema,
  zonalAdminListQuerySchema,
  zoneTeamParamsSchema,
  accessRequestIdParamsSchema,
  accessRequestListQuerySchema,
  approveAccessRequestSchema,
  createAccessRequestSchema,
  putZoneScopeSchema,
  rejectAccessRequestSchema,
} from '@zoauro/shared';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import type { AccessAdminService } from './access-admin.service';

// Parse (shared Zod schema) -> call the service -> send. No rules live here.

export function createAccessAdminController(service: AccessAdminService) {
  const memberId = (params: unknown) => parseBody(zonalAdminIdParamsSchema, params).id;
  const profileId = (params: unknown) => parseBody(accessProfileIdParamsSchema, params).id;

  return {
    listMembers: async (req, res) => {
      res.json(
        await service.listMembers(
          authContextOf(res),
          parseBody(zonalAdminListQuerySchema, req.query),
        ),
      );
    },
    createMember: async (req, res) => {
      res
        .status(201)
        .json(
          await service.createMember(
            authContextOf(res),
            parseBody(createZonalAdminSchema, req.body),
          ),
        );
    },
    getMember: async (req, res) => {
      res.json(await service.getMember(authContextOf(res), memberId(req.params)));
    },
    updateMember: async (req, res) => {
      res.json(
        await service.updateMember(
          authContextOf(res),
          memberId(req.params),
          parseBody(updateZonalAdminSchema, req.body),
        ),
      );
    },
    deleteMember: async (req, res) => {
      await service.deleteMember(authContextOf(res), memberId(req.params));
      res.status(204).end();
    },
    resetPassword: async (req, res) => {
      const { temporaryPassword } = parseBody(resetZonalAdminPasswordSchema, req.body);
      res.json(
        await service.resetPassword(authContextOf(res), memberId(req.params), temporaryPassword),
      );
    },
    revokeSessions: async (req, res) => {
      res.json(await service.revokeSessions(authContextOf(res), memberId(req.params)));
    },
    getAccess: async (req, res) => {
      res.json(await service.getAccess(authContextOf(res), memberId(req.params)));
    },
    putAccess: async (req, res) => {
      res.json(
        await service.putAccess(
          authContextOf(res),
          memberId(req.params),
          parseBody(putMemberAccessSchema, req.body),
        ),
      );
    },
    preview: async (req, res) => {
      const { zoneId } = parseBody(accessPreviewQuerySchema, req.query);
      res.json(await service.preview(authContextOf(res), memberId(req.params), zoneId));
    },
    addTeamMember: async (req, res) => {
      const { id, userId } = parseBody(zoneTeamParamsSchema, req.params);
      res
        .status(201)
        .json(
          await service.addTeamMember(
            authContextOf(res),
            id,
            userId,
            parseBody(addTeamMemberSchema, req.body),
          ),
        );
    },
    removeTeamMember: async (req, res) => {
      const { id, userId } = parseBody(zoneTeamParamsSchema, req.params);
      await service.removeTeamMember(authContextOf(res), id, userId);
      res.status(204).end();
    },
    listAccessChanges: async (req, res) => {
      res.json(
        await service.listAccessChanges(
          authContextOf(res),
          parseBody(accessChangeListQuerySchema, req.query),
        ),
      );
    },
    listProfiles: async (_req, res) => {
      res.json(await service.listProfiles(authContextOf(res)));
    },
    createProfile: async (req, res) => {
      res
        .status(201)
        .json(
          await service.createProfile(
            authContextOf(res),
            parseBody(createAccessProfileSchema, req.body),
          ),
        );
    },
    getProfile: async (req, res) => {
      res.json(await service.getProfile(authContextOf(res), profileId(req.params)));
    },
    updateProfile: async (req, res) => {
      res.json(
        await service.updateProfile(
          authContextOf(res),
          profileId(req.params),
          parseBody(updateAccessProfileSchema, req.body),
        ),
      );
    },
    deleteProfile: async (req, res) => {
      await service.deleteProfile(authContextOf(res), profileId(req.params));
      res.status(204).end();
    },
    getProfilePermissions: async (req, res) => {
      res.json(await service.getProfilePermissions(authContextOf(res), profileId(req.params)));
    },
    putProfilePermissions: async (req, res) => {
      res.json(
        await service.putProfilePermissions(
          authContextOf(res),
          profileId(req.params),
          parseBody(putAccessProfilePermissionsSchema, req.body),
        ),
      );
    },
    // access requests (R13, D115): the body is parsed first, then the service checks who asks
    myRequests: async (_req, res) => {
      res.json(await service.myRequests(authContextOf(res)));
    },
    createRequest: async (req, res) => {
      const input = parseBody(createAccessRequestSchema, req.body);
      res.status(201).json(await service.createRequest(authContextOf(res), input));
    },
    cancelRequest: async (req, res) => {
      const { id } = parseBody(accessRequestIdParamsSchema, req.params);
      res.json(await service.cancelRequest(authContextOf(res), id));
    },
    listRequests: async (req, res) => {
      res.json(
        await service.listRequests(
          authContextOf(res),
          parseBody(accessRequestListQuerySchema, req.query),
        ),
      );
    },
    getRequest: async (req, res) => {
      const { id } = parseBody(accessRequestIdParamsSchema, req.params);
      res.json(await service.getRequest(authContextOf(res), id));
    },
    approveRequest: async (req, res) => {
      const { id } = parseBody(accessRequestIdParamsSchema, req.params);
      const input = parseBody(approveAccessRequestSchema, req.body);
      res.json(await service.approveRequest(authContextOf(res), id, input));
    },
    rejectRequest: async (req, res) => {
      const { id } = parseBody(accessRequestIdParamsSchema, req.params);
      const input = parseBody(rejectAccessRequestSchema, req.body);
      res.json(await service.rejectRequest(authContextOf(res), id, input));
    },
    // zone scope preference (D116)
    putZoneScope: async (req, res) => {
      const { zoneIds } = parseBody(putZoneScopeSchema, req.body);
      res.json(await service.setZoneScope(authContextOf(res), zoneIds));
    },
  } satisfies Record<string, RequestHandler>;
}
