import { AUDIT_ACTIONS, isAuditActionKey } from '../../lib/audit/shared';
import type { AuditDetail, AuditListItem } from '../../lib/audit/shared';

export type AuditDbRow = {
  id: string; createdAt: Date;
  actorType: 'USER' | 'APP_CLIENT' | 'SYSTEM' | 'WEBHOOK'; actorId: string | null; actorName: string; actorRole: string | null;
  zoneId: string | null; module: string; action: string;
  entityType: string; entityId: string | null; entityLabel: string | null;
  outcome: 'SUCCESS' | 'DENIED'; sensitivity: 'NORMAL' | 'HIGH';
  beforeJson: unknown; afterJson: unknown; note: string | null;
  ip: string | null; userAgent: string | null; requestId: string | null;
};
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function flattenChanges(before: unknown, after: unknown, prefix = ''): { field: string; before: unknown; after: unknown }[] {
  const b = isObj(before) ? before : {}; const a = isObj(after) ? after : {};
  const out: { field: string; before: unknown; after: unknown }[] = [];
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    const path = `${prefix}${k}`;
    if (isObj(b[k]) && isObj(a[k])) out.push(...flattenChanges(b[k], a[k], `${path}.`));
    else out.push({ field: path, before: b[k], after: a[k] });
  }
  return out;
}

export function toListItem(r: AuditDbRow, opts: { viewerIsSuperAdmin: boolean; zoneNames: ReadonlyMap<string, string> }): AuditListItem {
  const label = isAuditActionKey(r.action) ? AUDIT_ACTIONS[r.action].label : r.action;
  const item: AuditListItem = {
    id: r.id, createdAt: r.createdAt.toISOString(),
    actor: { type: r.actorType, id: r.actorId, name: r.actorName, role: r.actorRole },
    zone: r.zoneId ? { id: r.zoneId, name: opts.zoneNames.get(r.zoneId) ?? null } : null,
    module: r.module, action: r.action, actionLabel: label,
    entity: { type: r.entityType, id: r.entityId, label: r.entityLabel },
    outcome: r.outcome, sensitivity: r.sensitivity, note: r.note,
    changedFields: flattenChanges(r.beforeJson, r.afterJson).map((c) => c.field),
  };
  // Staff IP/device/request id are personal data of admins: Super Admin only (doc 50 §2.2, doc 15).
  if (opts.viewerIsSuperAdmin) { item.ip = r.ip; item.userAgent = r.userAgent; item.requestId = r.requestId; }
  return item;
}

export function toDetail(r: AuditDbRow, opts: { viewerIsSuperAdmin: boolean; zoneNames: ReadonlyMap<string, string> }): AuditDetail {
  return { ...toListItem(r, opts), changes: flattenChanges(r.beforeJson, r.afterJson) };
}
