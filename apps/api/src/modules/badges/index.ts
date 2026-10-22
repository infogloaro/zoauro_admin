import { Router } from 'express';
import {
  accessRequestListQuerySchema,
  changeRequestListQuerySchema,
  partnerListQuerySchema,
  type MeBadges,
} from '@zoauro/shared';
import { requireSession } from '../../lib/auth/middleware';
import { authContextOf, type AuthContext } from '../../lib/authz';
import type { AccessAdminService } from '../access/access-admin.service';
import type { ClaimsService } from '../access/claims.service';
import type { PartnersService } from '../delivery-partners';
import type { ChangeRequestsService } from '../menu/change-requests.service';

// GET /me/badges (QA performance, checkpoint 1): the menu's waiting counts and the caller's open claims in one call
// instead of four. Each count comes from the same scoped list service its page uses (zones and permissions as there);
// a source the member cannot read, or that fails, is null and the menu simply shows no badge.

export function createBadgesModule(deps: {
  menuChanges: Pick<ChangeRequestsService, 'list'>;
  partners: Pick<PartnersService, 'list'>;
  access: Pick<AccessAdminService, 'listRequests'>;
  claims: Pick<ClaimsService, 'mine'>;
}): { router: Router } {
  const safe = async (load: () => Promise<number>): Promise<number | null> => {
    try {
      return await load();
    } catch {
      return null;
    }
  };
  const badges = async (ctx: AuthContext): Promise<MeBadges> => {
    const [foodRequests, partnerRequests, accessRequests, myClaims] = await Promise.all([
      safe(
        async () =>
          (
            await deps.menuChanges.list(
              ctx,
              changeRequestListQuerySchema.parse({ page: 1, pageSize: 1, status: 'PENDING' }),
            )
          ).meta.total,
      ),
      safe(
        async () =>
          (await deps.partners.list(ctx, partnerListQuerySchema.parse({ page: 1, pageSize: 1 })))
            .meta.counts.pendingVerification,
      ),
      // R13: the Super Admin's decision queue only
      ctx.isSuperAdmin
        ? safe(
            async () =>
              (
                await deps.access.listRequests(
                  ctx,
                  accessRequestListQuerySchema.parse({ status: 'PENDING', limit: 1 }),
                )
              ).meta.pendingCount,
          )
        : Promise.resolve(null),
      safe(async () => (await deps.claims.mine(ctx)).length),
    ]);
    return { foodRequests, partnerRequests, accessRequests, myClaims };
  };
  const router = Router();
  router.get('/me/badges', requireSession(), async (_req, res) => {
    res.json(await badges(authContextOf(res)));
  });
  return { router };
}
