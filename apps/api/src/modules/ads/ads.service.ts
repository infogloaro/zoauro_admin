import type {
  AdCampaign,
  AdCampaignListQuery,
  AdCampaignListResponse,
  AdCampaignStatus,
  AdQuoteInput,
  AdRejectInput,
  AdRequest,
  AdRequestListQuery,
  AdRequestListResponse,
  AdRequestStatus,
  AdsDashboard,
  AdSlot,
  AdSlotListQuery,
  AdSlotListResponse,
  AdSlotStatus,
  AdsRules,
  AdVendorType,
  PermissionKey,
  ZoneServiceKind,
} from '@zoauro/shared';
import { AD_CAMPAIGN_STATUSES, AD_REQUEST_STATUSES } from '@zoauro/shared';
import { record } from '../../lib/audit';
import { assertCanWrite, can, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError, type ErrorDetail } from '../../lib/errors';
import {
  bookedDays,
  bpToPct,
  CAMPAIGN_MOVES,
  canMove,
  commissionPaise,
  DAY_MS,
  fullDates,
  istMidnight,
  liveDays,
  liveWindows,
  pctToBp,
  serviceOfPage,
  SLOT_MOVES,
  slotLabel,
  type Pause,
} from './ads.rules';
import type {
  AdsDatabase,
  AdsRepository,
  CampaignRow,
  RequestRow,
  Scope,
  SlotRow,
  VendorKey,
} from './ads.repository';

// Advertising & Commission (D179, D182, D201). Lists and the dashboard read zonesFor(ctx, 'ads:view'); objects are 404
// outside it and writes 403 without the action in the object's zone. Money (billed fees, orders, commission) is shown
// per zone only with payments:view there (Super Admin always). Every write: row lock, If-Match version, one
// transaction with its audit row.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const HOUR_MS = 3_600_000;

export interface AdsDeps {
  db: AdsDatabase;
  clock: () => Date;
  /** settings ads.rules of the zone (SettingsReader.adsRules) */
  rules: (zoneId: string) => Promise<AdsRules>;
  /** D92 */
  services: { assertServiceEnabled(zoneId: string, service: ZoneServiceKind): Promise<void> };
  storage: { presignRead(key: string): Promise<string> };
}

function scopeOf(ctx: AuthContext, key: PermissionKey): Scope {
  const s = zonesFor(ctx, key);
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}

const stale = (row: { status: string; version: number }) =>
  new AppError('STALE_VERSION', 'Changed since it was read', undefined, undefined, {
    current: { status: row.status, version: row.version },
  });
const badMove = (message: string) => new AppError('INVALID_STATE_TRANSITION', message);

function vendorOf(row: {
  restaurant: { id: string; name: string } | null;
  homemaker: { id: string; name: string } | null;
  hotel: { id: string; name: string } | null;
}): { type: AdVendorType; id: string; name: string } {
  if (row.restaurant) return { type: 'RESTAURANT', ...row.restaurant };
  if (row.homemaker) return { type: 'HOMEMAKER', ...row.homemaker };
  if (row.hotel) return { type: 'HOTEL', ...row.hotel };
  throw new AppError('INTERNAL', 'Ad row without a vendor');
}
const vendorKey = (row: VendorKey): VendorKey => ({
  restaurantId: row.restaurantId,
  homemakerId: row.homemakerId,
  hotelId: row.hotelId,
});
const pct = (d: { toFixed(n: number): string } | null) => (d === null ? null : d.toFixed(2));

/** pauses_json: [{from, to|null}] as written by pause/resume/cancel and the seed. */
function pausesOf(json: unknown): Pause[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((p: unknown) => {
    if (typeof p !== 'object' || p === null) return [];
    const { from, to } = p as { from?: unknown; to?: unknown };
    if (typeof from !== 'string') return [];
    return [{ from: new Date(from), to: typeof to === 'string' ? new Date(to) : null }];
  });
}
const pausesJson = (pauses: readonly Pause[]) =>
  pauses.map((p) => ({ from: p.from.toISOString(), to: p.to?.toISOString() ?? null }));
const closePauses = (pauses: readonly Pause[], at: Date) =>
  pauses.map((p) => (p.to === null ? { from: p.from, to: at } : p));

function counts<S extends string>(all: readonly S[], got: Partial<Record<S, number>>) {
  return Object.fromEntries(all.map((s) => [s, got[s] ?? 0])) as Record<S, number>;
}

export class AdsService {
  constructor(private readonly deps: AdsDeps) {}

  // ---- slots ----

  async listSlots(ctx: AuthContext, q: AdSlotListQuery): Promise<AdSlotListResponse> {
    const { rows, total } = await this.deps.db.repo.listSlots(scopeOf(ctx, 'ads:view'), q);
    const booked = await this.deps.db.repo.bookedNow(
      rows.map((r) => r.id),
      this.deps.clock(),
    );
    return {
      data: rows.map((r) => toSlot(r, booked.get(r.id) ?? 0)),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async setSlotStatus(
    ctx: AuthContext,
    id: string,
    version: number,
    status: AdSlotStatus,
  ): Promise<AdSlot> {
    const seen = await this.deps.db.repo.slot(id);
    if (!seen || !can(ctx, 'ads:view', seen.zoneId)) throw notFound();
    assertCanWrite(ctx, 'ads:status', seen.zoneId);
    const row = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockSlot(id);
      const s = await tx.repo.slot(id);
      if (!s) throw notFound();
      if (s.version !== version) throw stale(s);
      if (!canMove(SLOT_MOVES, s.status, status))
        throw badMove(`A ${s.status.toLowerCase()} slot cannot move to ${status.toLowerCase()}`);
      if (status === 'RETIRED') {
        const open = await tx.repo.openCampaignsOnSlot(id);
        if (open > 0)
          throw new AppError(
            'INVALID_STATE_TRANSITION',
            'Campaigns still hold this slot',
            undefined,
            undefined,
            { campaigns: open },
          );
      }
      if (!(await tx.repo.setSlotStatus(id, version, status, ctx.userId))) throw stale(s);
      await record(tx.audit, {
        module: 'ads',
        action: 'ad_slot.status_changed',
        entity: { type: 'ad_slot', id, label: slotLabel(s), zoneId: s.zoneId },
        before: { status: s.status },
        after: { status },
      });
      return tx.repo.slot(id);
    });
    if (!row) throw notFound();
    const booked = await this.deps.db.repo.bookedNow([id], this.deps.clock());
    return toSlot(row, booked.get(id) ?? 0);
  }

  // ---- requests ----

  async listRequests(ctx: AuthContext, q: AdRequestListQuery): Promise<AdRequestListResponse> {
    const {
      rows,
      total,
      counts: got,
    } = await this.deps.db.repo.listRequests(scopeOf(ctx, 'ads:view'), q);
    const names = await this.deps.db.repo.userNames(rows.flatMap((r) => [r.quotedBy, r.decidedBy]));
    return {
      data: rows.map((r) => toRequest(r, names, null)),
      meta: { page: q.page, pageSize: q.pageSize, total },
      counts: counts(AD_REQUEST_STATUSES, got),
    };
  }

  async request(ctx: AuthContext, id: string): Promise<AdRequest> {
    const row = await this.deps.db.repo.request(id);
    if (!row || !can(ctx, 'ads:view', row.zoneId)) throw notFound();
    const names = await this.deps.db.repo.userNames([row.quotedBy, row.decidedBy]);
    return toRequest(row, names, await this.creativeUrl(row));
  }

  /** D201: sign only the key stored on the row, and only inside the vendor's own prefix (never a KYC document of another). */
  private async creativeUrl(row: RequestRow): Promise<string | null> {
    const key = row.creativeKey;
    if (!key) return null;
    if (!key.startsWith(`zone/${row.zoneId}/${vendorOf(row).id}/`)) return null;
    return this.deps.storage.presignRead(key);
  }

  async quote(
    ctx: AuthContext,
    id: string,
    version: number,
    input: AdQuoteInput,
  ): Promise<AdRequest> {
    const seen = await this.deps.db.repo.request(id);
    if (!seen || !can(ctx, 'ads:view', seen.zoneId)) throw notFound();
    assertCanWrite(ctx, 'ads:edit', seen.zoneId);
    const rules = await this.deps.rules(seen.zoneId);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockRequest(id);
      const r = await tx.repo.request(id);
      if (!r) throw notFound();
      if (r.version !== version) throw stale(r);
      if (r.status !== 'SUBMITTED') throw badMove('Only a waiting request can be quoted');
      const slot = await tx.repo.slot(input.slotId);
      if (
        !slot ||
        slot.zoneId !== r.zoneId ||
        slot.page !== r.page ||
        slot.placement !== r.placement ||
        slot.status !== 'ACTIVE'
      )
        throw new AppError(
          'VALIDATION_ERROR',
          'Pick an active slot of the same page and placement',
          [{ field: 'slotId', issue: 'wrong_slot' }],
        );
      const service = serviceOfPage(r.page);
      if (service) await this.deps.services.assertServiceEnabled(r.zoneId, service);

      const issues: ErrorDetail[] = [];
      if (
        r.requestedDays < slot.minDays ||
        r.requestedDays > Math.min(slot.maxDays, rules.maxCampaignDays)
      )
        issues.push({ field: 'requestedDays', issue: 'days_out_of_range' });
      const startAt = istMidnight(r.requestedStartDate);
      if (startAt.getTime() < now.getTime() + rules.minLeadHours * HOUR_MS)
        issues.push({ field: 'requestedStartDate', issue: 'lead_time' });
      if (startAt.getTime() > now.getTime() + rules.maxAheadDays * DAY_MS)
        issues.push({ field: 'requestedStartDate', issue: 'too_far_ahead' });
      if (r.placement === 'BANNER' && rules.bannerNeedsCreative && !r.creativeKey)
        issues.push({ field: 'creative', issue: 'creative_required' });

      let price: number | null = null;
      let bp: number | null = null;
      if (slot.pricing === 'FLAT_PER_DAY') {
        if (input.commissionPct !== undefined)
          issues.push({ field: 'commissionPct', issue: 'pricing_mismatch' });
        const list = slot.pricePerDayPaise ?? 0;
        price = input.pricePerDayPaise ?? list;
        // A4: at most quoteBandPercent below the list price (0 = the list price); above the list is allowed
        const lowest =
          list - Math.floor((list * Math.round(rules.quoteBandPercent * 100)) / 10_000);
        if (price < lowest) issues.push({ field: 'pricePerDayPaise', issue: 'below_band' });
      } else {
        if (input.pricePerDayPaise !== undefined)
          issues.push({ field: 'pricePerDayPaise', issue: 'pricing_mismatch' });
        const listBp = pctToBp(pct(slot.commissionPct)) ?? 0;
        bp = input.commissionPct !== undefined ? Math.round(input.commissionPct * 100) : listBp;
        if (bp > Math.round(rules.maxCommissionPercent * 100))
          issues.push({ field: 'commissionPct', issue: 'above_max' });
        // D155: a % other than the slot's list % is a commission change
        if (issues.length === 0 && bp !== listBp && !can(ctx, 'commission:edit', r.zoneId))
          throw new AppError('FORBIDDEN', 'Changing the commission % needs commission edit');
      }
      if (issues.length > 0)
        throw new AppError(
          'VALIDATION_ERROR',
          'The quote does not meet the advertising rules',
          issues,
        );

      if ((await tx.repo.openCampaignsOfVendor(vendorKey(r))) >= rules.maxLiveCampaignsPerVendor)
        throw new AppError('CONFLICT', 'The vendor already has the most campaigns allowed', [
          { field: 'vendor', issue: 'VENDOR_CAMPAIGN_LIMIT' },
        ]);
      const endAt = new Date(startAt.getTime() + r.requestedDays * DAY_MS);
      const full = fullDates(
        await tx.repo.bookedOnSlot(slot.id, startAt, endAt),
        slot.capacity,
        startAt,
        r.requestedDays,
      );
      if (full.length > 0)
        throw new AppError('SLOT_FULL', 'The slot is full on some days', undefined, undefined, {
          slotId: slot.id,
          fullDates: full,
        });

      const terms = await tx.repo.currentTerms(r.zoneId);
      const quote = {
        status: 'QUOTED' as const,
        slotId: slot.id,
        quotedPricing: slot.pricing,
        quotedPricePerDayPaise: price,
        quotedCommissionPct: bp === null ? null : bpToPct(bp),
        quotedTotalPaise: price === null ? null : price * r.requestedDays,
        quoteNote: input.note ?? null,
        quoteExpiresAt: new Date(now.getTime() + rules.quoteValidHours * HOUR_MS),
        termsId: terms?.id ?? null,
        quotedBy: ctx.userId,
        quotedAt: now,
      };
      if (!(await tx.repo.updateRequest(id, version, quote))) throw stale(r);
      await record(tx.audit, {
        module: 'ads',
        action: 'ad_request.quoted',
        entity: { type: 'ad_request', id, label: vendorOf(r).name, zoneId: r.zoneId },
        before: { status: r.status },
        after: {
          status: 'QUOTED',
          slot: slotLabel(slot),
          pricing: slot.pricing,
          pricePerDayPaise: price,
          commissionPct: quote.quotedCommissionPct,
          totalPaise: quote.quotedTotalPaise,
          expiresAt: quote.quoteExpiresAt.toISOString(),
          termsVersion: terms?.version ?? null,
        },
        note: input.note,
      });
    });
    return this.request(ctx, id);
  }

  async reject(
    ctx: AuthContext,
    id: string,
    version: number,
    input: AdRejectInput,
  ): Promise<AdRequest> {
    const seen = await this.deps.db.repo.request(id);
    if (!seen || !can(ctx, 'ads:view', seen.zoneId)) throw notFound();
    assertCanWrite(ctx, 'ads:status', seen.zoneId);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockRequest(id);
      const r = await tx.repo.request(id);
      if (!r) throw notFound();
      if (r.version !== version) throw stale(r);
      const from: AdRequestStatus = r.status;
      if (from !== 'SUBMITTED' && from !== 'QUOTED')
        throw badMove('Only a waiting or quoted request can be rejected');
      const ok = await tx.repo.updateRequest(id, version, {
        status: 'REJECTED',
        rejectReason: input.reason,
        decidedBy: ctx.userId,
        decidedAt: now,
      });
      if (!ok) throw stale(r);
      await record(tx.audit, {
        module: 'ads',
        action: 'ad_request.rejected',
        entity: { type: 'ad_request', id, label: vendorOf(r).name, zoneId: r.zoneId },
        before: { status: from },
        after: { status: 'REJECTED' },
        note: input.reason,
      });
    });
    return this.request(ctx, id);
  }

  // ---- campaigns ----

  async listCampaigns(ctx: AuthContext, q: AdCampaignListQuery): Promise<AdCampaignListResponse> {
    const {
      rows,
      total,
      counts: got,
    } = await this.deps.db.repo.listCampaigns(scopeOf(ctx, 'ads:view'), q);
    const now = this.deps.clock();
    return {
      data: await Promise.all(rows.map((r) => this.toCampaign(ctx, r, now))),
      meta: { page: q.page, pageSize: q.pageSize, total },
      counts: counts(AD_CAMPAIGN_STATUSES, got),
    };
  }

  pause(ctx: AuthContext, id: string, version: number, reason: string): Promise<AdCampaign> {
    return this.moveCampaign(ctx, id, version, 'PAUSED', reason);
  }

  resume(ctx: AuthContext, id: string, version: number): Promise<AdCampaign> {
    return this.moveCampaign(ctx, id, version, 'LIVE', null);
  }

  cancel(ctx: AuthContext, id: string, version: number, reason: string): Promise<AdCampaign> {
    return this.moveCampaign(ctx, id, version, 'CANCELLED', reason);
  }

  private async moveCampaign(
    ctx: AuthContext,
    id: string,
    version: number,
    to: 'PAUSED' | 'LIVE' | 'CANCELLED',
    reason: string | null,
  ): Promise<AdCampaign> {
    const seen = await this.deps.db.repo.campaign(id);
    if (!seen || !can(ctx, 'ads:view', seen.zoneId)) throw notFound();
    assertCanWrite(ctx, 'ads:status', seen.zoneId);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockCampaign(id);
      const c = await tx.repo.campaign(id);
      if (!c) throw notFound();
      if (c.version !== version) throw stale(c);
      const from: AdCampaignStatus = c.status;
      const pauses = pausesOf(c.pausesJson);
      const ended = now.getTime() >= c.endAt.getTime();
      // pause: LIVE only; resume: PAUSED only and before the fixed end date (A5)
      const allowed =
        canMove(CAMPAIGN_MOVES, from, to) &&
        (to === 'CANCELLED' || (!ended && (to === 'PAUSED' ? from === 'LIVE' : from === 'PAUSED')));
      if (!allowed) throw badMove(`A ${from.toLowerCase()} campaign cannot be ${verb(to)}`);
      const data =
        to === 'PAUSED'
          ? {
              status: to,
              pausedAt: now,
              pausesJson: pausesJson([...pauses, { from: now, to: null }]),
              updatedBy: ctx.userId,
            }
          : to === 'LIVE'
            ? {
                status: to,
                pausedAt: null,
                pausesJson: pausesJson(closePauses(pauses, now)),
                updatedBy: ctx.userId,
              }
            : {
                status: to,
                cancelledAt: now,
                cancelReason: reason,
                pausedAt: null,
                pausesJson: pausesJson(closePauses(pauses, now)),
                updatedBy: ctx.userId,
              };
      if (!(await tx.repo.updateCampaign(id, version, data))) throw stale(c);
      await record(tx.audit, {
        module: 'ads',
        action:
          to === 'PAUSED'
            ? 'ad_campaign.paused'
            : to === 'LIVE'
              ? 'ad_campaign.resumed'
              : 'ad_campaign.cancelled',
        entity: { type: 'ad_campaign', id, label: vendorOf(c).name, zoneId: c.zoneId },
        before: { status: from },
        after: { status: to },
        ...(reason ? { note: reason } : {}),
      });
    });
    const row = await this.deps.db.repo.campaign(id);
    if (!row) throw notFound();
    return this.toCampaign(ctx, row, now);
  }

  /** Billed days and money of one campaign; money only with payments:view in its zone (D201). */
  private async toCampaign(ctx: AuthContext, r: CampaignRow, now: Date): Promise<AdCampaign> {
    const pauses = pausesOf(r.pausesJson);
    const money = can(ctx, 'payments:view', r.zoneId)
      ? await earned(this.deps.db.repo, r, pauses, now)
      : null;
    return {
      id: r.id,
      zone: r.zone,
      vendor: vendorOf(r),
      slot: {
        id: r.slot.id,
        label: slotLabel(r.slot),
        page: r.slot.page,
        placement: r.slot.placement,
      },
      requestId: r.requestId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      pricing: r.pricing,
      pricePerDayPaise: r.pricePerDayPaise,
      commissionPct: pct(r.commissionPct),
      terms: r.adTerms,
      billingStatus: r.billingStatus,
      pauses: pauses.map((p) => ({ from: p.from.toISOString(), to: p.to?.toISOString() ?? null })),
      bookedDays: bookedDays(r),
      liveDays: liveDays({ ...r, pauses }, now),
      moneyVisible: money !== null,
      billedPaise: money?.billedPaise ?? null,
      orders: money?.orders ?? null,
      commissionPaise: money?.commissionPaise ?? null,
      earnedPaise: money?.earnedPaise ?? null,
      cancelReason: r.cancelReason,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      version: r.version,
    };
  }

  // ---- payouts (D182 A2) ----

  /**
   * The ad fees to deduct from a vendor's payout for [period.from, period.to): flat = live days inside the period ×
   * price; commission = delivered orders inside the live windows ∩ period × %. Hotels have no payout payee (D201).
   */
  async adFeesForPayout(
    payee: { type: 'RESTAURANT' | 'HOMEMAKER'; id: string },
    zoneId: string,
    period: { from: Date; to: Date },
    now: Date,
  ): Promise<{
    totalPaise: number;
    rows: {
      campaignId: string;
      slotLabel: string;
      pricing: 'FLAT_PER_DAY' | 'COMMISSION';
      days: number;
      earnedPaise: number;
    }[];
  }> {
    const repo = this.deps.db.repo;
    const vendor =
      payee.type === 'RESTAURANT' ? { restaurantId: payee.id } : { homemakerId: payee.id };
    const campaigns = await repo.pendingCampaignsOfVendor(vendor, zoneId, period.to);
    const rows = [];
    for (const c of campaigns) {
      const windows = clip(liveWindows({ ...c, pauses: pausesOf(c.pausesJson) }, now), period);
      if (windows.length === 0) continue;
      const days = Math.ceil(
        windows.reduce((t, [a, b]) => t + (b.getTime() - a.getTime()), 0) / DAY_MS,
      );
      let earnedPaise: number;
      if (c.pricing === 'FLAT_PER_DAY') earnedPaise = days * (c.pricePerDayPaise ?? 0);
      else {
        const orders = await repo.deliveredInWindows(vendorKey(c), c.zoneId, windows);
        earnedPaise = commissionPaise(orders.subtotalPaise, pctToBp(pct(c.commissionPct)) ?? 0);
      }
      rows.push({
        campaignId: c.id,
        slotLabel: slotLabel(c.slot),
        pricing: c.pricing,
        days,
        earnedPaise,
      });
    }
    return { totalPaise: rows.reduce((t, r) => t + r.earnedPaise, 0), rows };
  }

  // ---- dashboard ----

  /** The zones come from the request scope (?zoneId is resolved by the auth context middleware). */
  async dashboard(ctx: AuthContext): Promise<AdsDashboard> {
    const now = this.deps.clock();
    const scope = scopeOf(ctx, 'ads:view');
    const repo = this.deps.db.repo;
    const c = await repo.dashboardCounts(scope, now, new Date(now.getTime() - 30 * DAY_MS));
    // money: the ads scope narrowed to the zones with payments:view (a Super Admin holds it everywhere)
    const pay = scopeOf(ctx, 'payments:view');
    const moneyScope: Scope =
      scope === 'ALL' ? pay : pay === 'ALL' ? scope : scope.filter((z) => pay.includes(z));
    let money: AdsDashboard['money'] = null;
    if (moneyScope === 'ALL' || moneyScope.length > 0) {
      const campaigns = await repo.earningCampaigns(moneyScope);
      const figures = await Promise.all(
        campaigns.map(async (r) => ({
          r,
          m: await earned(repo, r, pausesOf(r.pausesJson), now),
        })),
      );
      const sum = (pick: (f: (typeof figures)[number]) => number) =>
        figures.reduce((t, f) => t + pick(f), 0);
      const flat = sum((f) => f.m.billedPaise);
      const commission = sum((f) => f.m.commissionPaise ?? 0);
      const top = new Map<string, { r: CampaignRow; campaigns: number; earnedPaise: number }>();
      for (const f of figures) {
        const key = vendorOf(f.r).id;
        const t = top.get(key) ?? { r: f.r, campaigns: 0, earnedPaise: 0 };
        top.set(key, {
          ...t,
          campaigns: t.campaigns + 1,
          earnedPaise: t.earnedPaise + f.m.earnedPaise,
        });
      }
      money = {
        zones: moneyScope === 'ALL' ? 'ALL' : [...moneyScope],
        flatBilledPaise: flat,
        commissionEarnedPaise: commission,
        totalEarnedPaise: flat + commission,
        // hotels have no payout payee: their campaigns are billed to the hotel
        dueFromPayoutsPaise: sum((f) =>
          f.r.billingStatus === 'PENDING' && f.r.hotelId === null ? f.m.earnedPaise : 0,
        ),
        billedToHotelsPaise: sum((f) => (f.r.hotelId !== null ? f.m.earnedPaise : 0)),
        topVendors: [...top.values()]
          .sort((a, b) => b.earnedPaise - a.earnedPaise)
          .slice(0, 5)
          .map((t) => ({
            vendor: vendorOf(t.r),
            zone: t.r.zone,
            campaigns: t.campaigns,
            earnedPaise: t.earnedPaise,
          })),
      };
    }
    return {
      asOf: now.toISOString(),
      zones: scope === 'ALL' ? 'ALL' : [...scope],
      counts: {
        slotsActive: c.slotsActive,
        requestsSubmitted: c.requests.SUBMITTED ?? 0,
        requestsQuoted: c.requests.QUOTED ?? 0,
        campaignsScheduled: c.campaigns.SCHEDULED ?? 0,
        campaignsLive: c.campaigns.LIVE ?? 0,
        campaignsPaused: c.campaigns.PAUSED ?? 0,
        campaignsEnded30d: c.ended30d,
      },
      occupancyToday: { booked: c.booked, capacity: c.capacity },
      money,
    };
  }
}

const verb = (to: 'PAUSED' | 'LIVE' | 'CANCELLED') =>
  to === 'PAUSED' ? 'paused' : to === 'LIVE' ? 'resumed' : 'cancelled';

/** Flat: billed days × price. Commission: floor(Σ delivered subtotal in the live windows × bp / 10000). */
/** The parts of the windows inside [period.from, period.to). */
function clip(windows: [Date, Date][], period: { from: Date; to: Date }): [Date, Date][] {
  return windows.flatMap(([a, b]): [Date, Date][] => {
    const from = Math.max(a.getTime(), period.from.getTime());
    const to = Math.min(b.getTime(), period.to.getTime());
    return from < to ? [[new Date(from), new Date(to)]] : [];
  });
}

async function earned(repo: AdsRepository, r: CampaignRow, pauses: Pause[], now: Date) {
  const times = { ...r, pauses };
  if (r.pricing === 'FLAT_PER_DAY') {
    const billed = liveDays(times, now) * (r.pricePerDayPaise ?? 0);
    return { billedPaise: billed, orders: null, commissionPaise: null, earnedPaise: billed };
  }
  const orders = await repo.deliveredInWindows(vendorKey(r), r.zoneId, liveWindows(times, now));
  const commission = commissionPaise(orders.subtotalPaise, pctToBp(pct(r.commissionPct)) ?? 0);
  return { billedPaise: 0, orders, commissionPaise: commission, earnedPaise: commission };
}

function toSlot(r: SlotRow, bookedNow: number): AdSlot {
  return {
    id: r.id,
    zone: r.zone,
    page: r.page,
    placement: r.placement,
    position: r.position,
    label: slotLabel(r),
    capacity: r.capacity,
    pricing: r.pricing,
    pricePerDayPaise: r.pricePerDayPaise,
    commissionPct: pct(r.commissionPct),
    minDays: r.minDays,
    maxDays: r.maxDays,
    terms: r.terms,
    status: r.status,
    bookedNow,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toRequest(
  r: RequestRow,
  names: Map<string, string>,
  creativeUrl: string | null,
): AdRequest {
  const user = (id: string | null) => (id ? { id, name: names.get(id) ?? 'Unknown' } : null);
  return {
    id: r.id,
    zone: r.zone,
    vendor: vendorOf(r),
    page: r.page,
    placement: r.placement,
    requestedStartDate: r.requestedStartDate.toISOString().slice(0, 10),
    requestedDays: r.requestedDays,
    creativeUrl,
    hasCreative: r.creativeKey !== null,
    vendorNote: r.vendorNote,
    status: r.status,
    slot: r.slot ? { id: r.slot.id, label: slotLabel(r.slot), pricing: r.slot.pricing } : null,
    quote:
      r.quotedPricing && r.quoteExpiresAt && r.quotedAt
        ? {
            pricing: r.quotedPricing,
            pricePerDayPaise: r.quotedPricePerDayPaise,
            commissionPct: pct(r.quotedCommissionPct),
            totalPaise: r.quotedTotalPaise,
            note: r.quoteNote,
            expiresAt: r.quoteExpiresAt.toISOString(),
            quotedAt: r.quotedAt.toISOString(),
            quotedBy: user(r.quotedBy),
          }
        : null,
    terms: r.adTerms,
    decision:
      r.status === 'REJECTED' && r.rejectReason && r.decidedAt
        ? {
            rejectReason: r.rejectReason,
            decidedAt: r.decidedAt.toISOString(),
            decidedBy: user(r.decidedBy),
          }
        : null,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    campaignId: r.campaign?.id ?? null,
    source: r.source === 'ADMIN' ? 'ADMIN' : 'APP',
    submittedAt: r.submittedAt.toISOString(),
    version: r.version,
  };
}
