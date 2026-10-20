// Who may read which audit rows (doc 50 §2.2). Pure functions: the repository turns the predicate into SQL.
import { ZONAL_HIDDEN_AUDIT_MODULES, AUDIT_MODULES, isEntityMode } from '../../lib/audit/shared';
import type { AuditListQuery, AuditModule } from '../../lib/audit/shared';

export type AuditViewer = {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** doc 14 §4: can(ctx, 'module:action', zoneId) */
  can(permission: string, zoneId: string): boolean;
  /** doc 14 §4: zonesFor(ctx, 'module:view') */
  zonesFor(permission: string): string[];
};
export type AuditRowRef = { module: string; zoneId: string | null };

export function canSeeRow(viewer: AuditViewer, row: AuditRowRef): boolean {
  if (viewer.role === 'SUPER_ADMIN') return true;
  if (row.zoneId === null) return false;
  if ((ZONAL_HIDDEN_AUDIT_MODULES as ReadonlySet<string>).has(row.module)) return false;
  return viewer.can(`${row.module}:view`, row.zoneId);
}

/** (module, zones) pairs a Zonal viewer may read. Repository: WHERE (module = m1 AND zone_id IN z1) OR (...). Empty list = sees nothing. */
export type ZonalPredicate = { module: AuditModule; zoneIds: string[] }[];
export function zonalPredicate(viewer: AuditViewer): ZonalPredicate {
  const out: ZonalPredicate = [];
  for (const m of AUDIT_MODULES) {
    if (ZONAL_HIDDEN_AUDIT_MODULES.has(m)) continue;
    const zoneIds = viewer.zonesFor(`${m}:view`);
    if (zoneIds.length > 0) out.push({ module: m, zoneIds: [...zoneIds].sort() });
  }
  return out;
}

export function matchesPredicate(pred: ZonalPredicate, row: AuditRowRef): boolean {
  return (
    row.zoneId !== null &&
    pred.some((p) => p.module === row.module && p.zoneIds.includes(row.zoneId as string))
  );
}

export type ListPlan =
  | { allowed: false; status: 403; reason: string }
  | { allowed: true; mode: 'ALL'; filters: AuditListQuery }
  | {
      allowed: true;
      mode: 'ENTITY';
      filters: Pick<AuditListQuery, 'limit' | 'after' | 'from' | 'to' | 'entityType' | 'entityId'>;
      predicate: ZonalPredicate;
    };

/** Decide what a caller may do with GET /audit-logs. Zonal without entity mode → 403; Zonal in entity mode → only paging + date filters survive. */
export function planAuditList(viewer: AuditViewer, q: AuditListQuery): ListPlan {
  if (viewer.role === 'SUPER_ADMIN') return { allowed: true, mode: 'ALL', filters: q };
  if (!isEntityMode(q))
    return { allowed: false, status: 403, reason: 'free listing requires audit:view' };
  const { limit, after, from, to, entityType, entityId } = q;
  return {
    allowed: true,
    mode: 'ENTITY',
    filters: { limit, after, from, to, entityType, entityId },
    predicate: zonalPredicate(viewer),
  };
}

/** Zonal entity mode: nothing visible on the first page means "not yours or not there" → 404 (never an empty 200 that leaks existence rules). */
export function entityModeNotFound(plan: ListPlan, visibleRowsOnFirstPage: number): boolean {
  return (
    plan.allowed &&
    plan.mode === 'ENTITY' &&
    plan.filters.after === undefined &&
    visibleRowsOnFirstPage === 0
  );
}
