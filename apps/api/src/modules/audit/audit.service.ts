import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  buildCursorPage,
  type AuditActionKey,
  type AuditActorSearchQuery,
  type AuditCatalogue,
  type AuditDetail,
  type AuditListQuery,
  type AuditListResponse,
  type CursorPage,
  type LoginHistoryItem,
  type LoginHistoryQuery,
} from '@zoauro/shared';
import { maskEmail } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { AuditRepository } from './audit.repository';
import { toDetail, toListItem, type AuditDbRow } from './mapper';
import { viewerOf } from './permissions';
import { entityModeNotFound, planAuditList, zonalPredicate } from './visibility';

/** /me/login-history: "own last 50 sign-ins" (doc 50 section 8). */
export const MY_LOGIN_HISTORY_LIMIT = 50;

type LoginRow = Awaited<ReturnType<AuditRepository['myLoginHistory']>>[number];
const toLoginItem = (r: LoginRow, maskOthers: boolean): LoginHistoryItem => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  userId: r.userId,
  emailAttempted: maskOthers ? maskEmail(r.emailAttempted) : r.emailAttempted,
  success: r.success,
  reason: r.reason,
  ip: r.ip,
  userAgent: r.userAgent,
});

export class AuditReadService {
  constructor(private readonly repo: AuditRepository) {}

  private async zoneNamesFor(ctx: AuthContext, rows: AuditDbRow[]) {
    return this.repo.zoneNames(
      ctx,
      rows.flatMap((r) => (r.zoneId ? [r.zoneId] : [])),
    );
  }

  /** GET /audit-logs. Zonal without entity mode -> 403; Zonal entity mode with nothing visible on page 1 -> 404. */
  async list(ctx: AuthContext, query: AuditListQuery): Promise<AuditListResponse> {
    const plan = planAuditList(viewerOf(ctx), query);
    if (!plan.allowed) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
    const rows = await this.repo.list(ctx, plan);
    const page = buildCursorPage(rows, plan.filters.limit, (r) => r.id);
    if (entityModeNotFound(plan, page.data.length)) throw new AppError('NOT_FOUND', 'Not found');
    const zoneNames = await this.zoneNamesFor(ctx, page.data);
    return {
      data: page.data.map((r) =>
        toListItem(r, { viewerIsSuperAdmin: ctx.isSuperAdmin, zoneNames }),
      ),
      meta: page.meta,
    };
  }

  /** GET /audit-logs/{id}: 404 when missing or not visible (same answer, existence is never revealed). */
  async detail(ctx: AuthContext, id: string): Promise<AuditDetail> {
    const predicate = ctx.isSuperAdmin ? [] : zonalPredicate(viewerOf(ctx));
    const row = await this.repo.findById(ctx, id, predicate);
    if (!row) throw new AppError('NOT_FOUND', 'Not found');
    const zoneNames = await this.zoneNamesFor(ctx, [row]);
    return toDetail(row, { viewerIsSuperAdmin: ctx.isSuperAdmin, zoneNames });
  }

  catalogue(): AuditCatalogue {
    return {
      modules: [...AUDIT_MODULES],
      actions: (Object.keys(AUDIT_ACTIONS) as AuditActionKey[]).map((key) => ({
        key,
        module: AUDIT_ACTIONS[key].module,
        label: AUDIT_ACTIONS[key].label,
      })),
    };
  }

  async searchActors(ctx: AuthContext, query: AuditActorSearchQuery) {
    return { data: await this.repo.searchActors(ctx, query.q, query.limit) };
  }

  async zoneOptions(ctx: AuthContext) {
    return { data: await this.repo.listZoneOptions(ctx) };
  }

  async loginHistory(
    ctx: AuthContext,
    query: LoginHistoryQuery,
  ): Promise<CursorPage<LoginHistoryItem>> {
    const rows = await this.repo.listLoginHistory(ctx, query);
    const page = buildCursorPage(rows, query.limit, (r) => r.id);
    return { data: page.data.map((r) => toLoginItem(r, true)), meta: page.meta };
  }

  async myLoginHistory(ctx: AuthContext): Promise<{ data: LoginHistoryItem[] }> {
    const rows = await this.repo.myLoginHistory(ctx, MY_LOGIN_HISTORY_LIMIT);
    return { data: rows.map((r) => toLoginItem(r, false)) };
  }
}
