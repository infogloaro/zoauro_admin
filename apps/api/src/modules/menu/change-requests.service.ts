import type {
  ChangeRequestApproveInput,
  ChangeRequestDetail,
  ChangeRequestListItem,
  ChangeRequestListQuery,
  ChangeRequestListResponse,
  ChangeRequestRejectInput,
  MenuChangeKind,
  MenuChangeProposal,
  MenuVendorKind,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import {
  approvedCreate,
  approvedUpdate,
  changeRows,
  changedFields,
  decisionBlocker,
  splitVendorChange,
} from './change-requests.rules';
import { changeDecidedRow } from './menu.events';
import type { ChangeRequestRecord, MenuDatabase, MenuItemRecord, MenuTx } from './menu.repository';

// Vendor item-change requests (R09, D119, D125, D127). The approved value stays live until a decision. Approve and
// reject need menu:status in the request's zone and the version the reviewer saw; both lock the request (and the item)
// FOR UPDATE, write the audit row and the menu_item.change_decided event in the same transaction, so a failure leaves
// the request PENDING and the item untouched. `submit` is the port the intake module calls for vendor app changes.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const conflict = (m: string) => new AppError('CONFLICT', m);

export interface ChangeSubmission {
  zoneId: string;
  vendor: { kind: MenuVendorKind; id: string };
  kind: MenuChangeKind;
  /** UPDATE and DELETE: the item; CREATE: none yet */
  menuItemId?: string;
  /** the vendor app's item id and client (CREATE: one PENDING per client + external id) */
  externalItemId?: string;
  clientId?: string;
  proposal: MenuChangeProposal;
}

export class ChangeRequestsService {
  constructor(private readonly deps: { db: MenuDatabase; clock: () => Date }) {}

  async list(ctx: AuthContext, q: ChangeRequestListQuery): Promise<ChangeRequestListResponse> {
    const { rows, total } = await this.deps.db.repo.listChanges(ctx, q);
    return { data: rows.map(listItem), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async detail(ctx: AuthContext, id: string): Promise<ChangeRequestDetail> {
    const r = await this.deps.db.repo.findChange(ctx, id);
    if (!r) throw notFound();
    const live = r.menuItem ? await this.deps.db.repo.getItem(r.menuItem.id) : null;
    return toDetail(r, live ? liveProposal(live) : null);
  }

  async approve(
    ctx: AuthContext,
    id: string,
    input: ChangeRequestApproveInput,
  ): Promise<ChangeRequestDetail> {
    const seen = await this.decidable(ctx, id, input.version);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockChange(id);
      const r = await this.current(tx, id, input.version);
      let itemId = r.menuItem?.id ?? null;
      let label = r.menuItem?.name ?? String(r.proposed.name ?? 'Menu item');
      let before: unknown;
      let after: unknown;
      if (r.kind === 'CREATE') {
        const c = approvedCreate(r.proposed);
        if (!c.ok) throw conflict(`The request misses ${c.missing.join(', ')}`);
        await this.assertCategory(tx, c.row.categoryId, r.zoneId);
        itemId = uuidv7();
        label = c.row.name;
        await tx.repo.insertItem({
          id: itemId,
          zoneId: r.zoneId,
          vendor: { kind: r.vendor.kind, id: r.vendor.id },
          categoryId: c.row.categoryId,
          name: c.row.name,
          description: c.row.description,
          price: c.row.price,
          stock: c.row.stock,
          isAvailable: c.row.isAvailable,
          isFeatured: false,
          dietary: c.row.dietary,
          imageKey: c.row.imageKey,
          createdBy: ctx.userId,
        });
        if (r.submittedByClientId && r.externalItemId)
          await tx.repo.insertExternalRef({
            clientId: r.submittedByClientId,
            externalId: r.externalItemId,
            internalId: itemId,
          });
        after = c.row;
      } else {
        if (!itemId) throw conflict('The item of this request no longer exists');
        await tx.repo.lockItems([itemId]);
        const item = await tx.repo.getItem(itemId);
        if (!item) throw conflict('The item of this request no longer exists');
        before = liveProposal(item);
        if (r.kind === 'UPDATE') {
          const w = approvedUpdate(r.proposed);
          if (w.categoryId !== undefined) await this.assertCategory(tx, w.categoryId, r.zoneId);
          await tx.repo.updateItem(itemId, w, ctx.userId);
          after = { ...liveProposal(item), ...w };
        } else {
          await tx.repo.updateItem(itemId, { deletedAt: now }, ctx.userId);
        }
      }
      await tx.repo.decideChange(id, {
        status: 'APPROVED',
        decidedBy: ctx.userId,
        decidedAt: now,
        decisionReason: null,
        ...(r.kind === 'CREATE' && itemId ? { menuItemId: itemId } : {}),
      });
      await record(tx.audit, {
        module: 'menu',
        action: 'menu_item.change_approved',
        entity: { type: 'menu_item', ...(itemId ? { id: itemId } : {}), label, zoneId: r.zoneId },
        before,
        after,
        note: `${r.kind} request ${r.id}`,
      });
      await tx.repo.insertOutbox([
        changeDecidedRow(
          { ...r, vendorId: r.vendor.id, menuItemId: itemId, version: r.version + 1 },
          'APPROVED',
          undefined,
          ctx.userId,
          now,
        ),
      ]);
    });
    return this.detail(ctx, seen.id);
  }

  async reject(
    ctx: AuthContext,
    id: string,
    input: ChangeRequestRejectInput,
  ): Promise<ChangeRequestDetail> {
    await this.decidable(ctx, id, input.version);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockChange(id);
      const r = await this.current(tx, id, input.version);
      await tx.repo.decideChange(id, {
        status: 'REJECTED',
        decidedBy: ctx.userId,
        decidedAt: now,
        decisionReason: input.reason,
      });
      await record(tx.audit, {
        module: 'menu',
        action: 'menu_item.change_rejected',
        entity: {
          type: 'menu_item',
          ...(r.menuItem ? { id: r.menuItem.id } : {}),
          label: r.menuItem?.name ?? String(r.proposed.name ?? 'Menu item'),
          zoneId: r.zoneId,
        },
        note: `${r.kind} request ${r.id}: ${input.reason}`,
      });
      await tx.repo.insertOutbox([
        changeDecidedRow(
          {
            ...r,
            vendorId: r.vendor.id,
            menuItemId: r.menuItem?.id ?? null,
            version: r.version + 1,
          },
          'REJECTED',
          input.reason,
          ctx.userId,
          now,
        ),
      ]);
    });
    return this.detail(ctx, id);
  }

  /**
   * Port for the intake module (vendor app, doc 42): stock and availability apply at once; the approval fields become
   * a PENDING request that supersedes the open one of the same item (or the same client + external id for a CREATE).
   * Runs in the caller's audit context; returns the new request id, or null when nothing needs approval.
   */
  async submit(s: ChangeSubmission): Promise<{ requestId: string | null }> {
    return this.deps.db.transaction(async (tx) => {
      const now = this.deps.clock();
      let base: MenuChangeProposal | null = null;
      let proposal = s.proposal;
      if (s.kind !== 'CREATE') {
        if (!s.menuItemId) throw new Error('submit: menuItemId is required for UPDATE and DELETE');
        await tx.repo.lockItems([s.menuItemId]);
        const item = await tx.repo.getItem(s.menuItemId);
        if (!item || item.zoneId !== s.zoneId) throw notFound();
        base = liveProposal(item);
        if (s.kind === 'UPDATE') {
          const { needsApproval, immediate } = splitVendorChange(s.proposal);
          if (Object.keys(immediate).length > 0) await tx.repo.updateItem(item.id, immediate, null);
          if (Object.keys(needsApproval).length === 0) return { requestId: null };
          proposal = needsApproval;
        } else proposal = {};
      }
      const open = await tx.repo.pendingChangeFor(
        s.kind === 'CREATE'
          ? { clientId: s.clientId ?? '', externalItemId: s.externalItemId ?? '' }
          : { menuItemId: s.menuItemId ?? '' },
      );
      if (open)
        await tx.repo.decideChange(open.id, {
          status: 'SUPERSEDED',
          decidedBy: null,
          decidedAt: now,
          decisionReason: null,
        });
      const id = uuidv7();
      await tx.repo.insertChange({
        id,
        zoneId: s.zoneId,
        menuItemId: s.kind === 'CREATE' ? null : (s.menuItemId ?? null),
        vendor: s.vendor,
        externalItemId: s.externalItemId ?? null,
        kind: s.kind,
        proposed: proposal,
        base,
        source: 'APP',
        submittedByClientId: s.clientId ?? null,
      });
      return { requestId: id };
    });
  }

  /** Visible (404), the action in its zone (404/403), still PENDING at that version (409). */
  private async decidable(
    ctx: AuthContext,
    id: string,
    version: number,
  ): Promise<ChangeRequestRecord> {
    const r = await this.deps.db.repo.findChange(ctx, id);
    if (!r) throw notFound();
    assertCanWrite(ctx, 'menu:status', r.zoneId);
    assertDecidable(r, version);
    return r;
  }

  private async current(tx: MenuTx, id: string, version: number): Promise<ChangeRequestRecord> {
    const r = await tx.repo.getChange(id);
    if (!r) throw notFound();
    assertDecidable(r, version);
    return r;
  }

  private async assertCategory(tx: MenuTx, categoryId: string, zoneId: string): Promise<void> {
    const c = await tx.repo.categoryRef(categoryId);
    if (!c || (c.zoneId !== null && c.zoneId !== zoneId))
      throw conflict('The proposed category no longer exists in this zone');
  }
}

function assertDecidable(r: ChangeRequestRecord, version: number): void {
  const blocker = decisionBlocker(r, version);
  if (blocker === 'NOT_PENDING')
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `This request is already ${r.status.toLowerCase()}`,
    );
  if (blocker === 'STALE_VERSION')
    throw new AppError(
      'STALE_VERSION',
      'The request changed since it was opened',
      undefined,
      undefined,
      {
        current: { status: r.status, version: r.version },
      },
    );
}

/** The item's current values in proposal terms (review "live" column and base_json). */
function liveProposal(i: MenuItemRecord): MenuChangeProposal {
  return {
    name: i.name,
    description: i.description,
    price: i.price,
    categoryId: i.category.id,
    dietary: i.dietary,
    imageKey: i.imageKey,
    stock: i.stock,
    isAvailable: i.isAvailable,
  };
}

function listItem(r: ChangeRequestRecord): ChangeRequestListItem {
  return {
    id: r.id,
    zone: r.zone,
    vendor: r.vendor,
    menuItem: r.menuItem ? { id: r.menuItem.id, name: r.menuItem.name } : null,
    name: r.proposed.name ?? r.menuItem?.name ?? 'Menu item',
    kind: r.kind,
    status: r.status,
    fields: changedFields(r.proposed),
    decidedBy: r.decider,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionReason: r.decisionReason,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
  };
}

function toDetail(r: ChangeRequestRecord, live: MenuChangeProposal | null): ChangeRequestDetail {
  return {
    ...listItem(r),
    proposed: r.proposed,
    base: r.base,
    live,
    changes: changeRows(r.proposed, r.base, live),
  };
}
