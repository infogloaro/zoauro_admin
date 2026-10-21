import {
  ONBOARDING_AGE_LEVELS,
  ONBOARDING_STAGES,
  ONBOARDING_TYPES,
  onboardingAgeLevel,
  type AuditActionKey,
  type ClaimEntityType,
  type CreateClaimInput,
  type OnboardingCounts,
  type OnboardingItem,
  type OnboardingListQuery,
  type OnboardingListResponse,
  type OnboardingModule,
  type OnboardingMoreInfoInput,
  type PermissionKey,
  type VendorStatus,
  type VerificationStatus,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { OnboardingDatabase, OnboardingRow } from './onboarding.repository';

// Onboarding queue (D170, D174). Start review: the reviewer claims the record (D174 claims service; someone else's
// live claim is 409 RECORD_CLAIMED) and the stage moves to UNDER_REVIEW. More info: UNDER_REVIEW → MORE_INFO_REQUIRED
// ("Waiting for vendor") with a message the vendor app receives (outbox onboarding.more_info_required); the vendor's
// resubmission (intake) moves it back to SUBMITTED. DECIDED follows the verification decision.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const ENTITY: Record<
  OnboardingModule,
  { audit: 'restaurant' | 'homemaker' | 'hotel'; claim: ClaimEntityType }
> = {
  restaurants: { audit: 'restaurant', claim: 'RESTAURANT' },
  homemakers: { audit: 'homemaker', claim: 'HOMEMAKER' },
  hotels: { audit: 'hotel', claim: 'HOTEL' },
};
const HOUR = 3_600_000;

export interface OnboardingDeps {
  db: OnboardingDatabase;
  /** the access module's claims service (D174) */
  claims: {
    claim(ctx: AuthContext, input: CreateClaimInput): Promise<unknown>;
    assertNotClaimedByOther(ctx: AuthContext, type: ClaimEntityType, id: string): Promise<void>;
  };
  clock: () => Date;
}

export class OnboardingService {
  constructor(private readonly deps: OnboardingDeps) {}

  async list(ctx: AuthContext, q: OnboardingListQuery): Promise<OnboardingListResponse> {
    const now = this.deps.clock();
    const [{ rows, total }, groups] = await Promise.all([
      this.deps.db.repo.list(ctx, q, now),
      this.deps.db.repo.counts(ctx, q.q, now),
    ]);
    const messages = await this.deps.db.repo.lastMessages(
      rows.filter((r) => r.stage === 'MORE_INFO_REQUIRED').map((r) => r.id),
    );
    return {
      data: rows.map((r) => item(r, now, messages.get(r.id) ?? null)),
      meta: { page: q.page, pageSize: q.pageSize, total, counts: counts(groups) },
    };
  }

  async startReview(
    ctx: AuthContext,
    module: OnboardingModule,
    id: string,
  ): Promise<OnboardingItem> {
    const r = await this.writable(ctx, module, id);
    if (r.stage !== 'SUBMITTED' && r.stage !== 'MORE_INFO_REQUIRED')
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `This ${label(module)} is already ${words(r.stage)}`,
      );
    await this.deps.claims.claim(ctx, { entityType: ENTITY[module].claim, entityId: id });
    return this.move(
      ctx,
      module,
      r,
      'UNDER_REVIEW',
      ['SUBMITTED', 'MORE_INFO_REQUIRED'],
      undefined,
    );
  }

  async requestMoreInfo(
    ctx: AuthContext,
    module: OnboardingModule,
    id: string,
    input: OnboardingMoreInfoInput,
  ): Promise<OnboardingItem> {
    const r = await this.writable(ctx, module, id);
    if (r.stage !== 'UNDER_REVIEW')
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        'Start the review before asking for more information',
      );
    await this.deps.claims.assertNotClaimedByOther(ctx, ENTITY[module].claim, id);
    return this.move(ctx, module, r, 'MORE_INFO_REQUIRED', ['UNDER_REVIEW'], input.message);
  }

  /** Visible (404), `<module>:status` in its zone (404/403); a record without a zone needs one first (409). */
  private async writable(
    ctx: AuthContext,
    module: OnboardingModule,
    id: string,
  ): Promise<OnboardingRow> {
    const r = await this.deps.db.repo.one(ctx, module, id);
    if (!r) throw notFound();
    if (r.zoneId === null) {
      if (!ctx.isSuperAdmin) throw notFound();
      // as the vendor modules: an app sign-up gets its zone (move-zone) before anyone works on it
      throw new AppError('CONFLICT', 'Assign the record to a zone before reviewing it');
    }
    assertCanWrite(ctx, `${module}:status` as PermissionKey, r.zoneId);
    return r;
  }

  private async move(
    ctx: AuthContext,
    module: OnboardingModule,
    seen: OnboardingRow,
    to: 'UNDER_REVIEW' | 'MORE_INFO_REQUIRED',
    from: readonly string[],
    message: string | undefined,
  ): Promise<OnboardingItem> {
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      const current = await tx.repo.lock(module, seen.id);
      if (!current) throw notFound();
      if (current.verification !== 'PENDING' || !from.includes(current.stage))
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `This ${label(module)} moved on; reload the queue`,
        );
      await tx.repo.setStage(module, seen.id, to, now, ctx.userId);
      const entity = ENTITY[module].audit;
      await record(tx.audit, {
        module,
        action:
          `${entity}.${to === 'UNDER_REVIEW' ? 'onboarding_review_started' : 'more_info_requested'}` as AuditActionKey,
        entity: { type: entity, id: seen.id, label: seen.name, zoneId: seen.zoneId },
        before: { stage: current.stage },
        after: { stage: to },
        ...(message ? { note: message } : {}),
      });
      if (to === 'MORE_INFO_REQUIRED' && message) {
        const eventId = uuidv7();
        await tx.repo.insertOutbox([
          {
            id: eventId,
            eventType: 'onboarding.more_info_required',
            zoneId: seen.zoneId,
            payload: {
              eventId,
              type: 'onboarding.more_info_required',
              schemaVersion: 1,
              occurredAt: now.toISOString(),
              aggregate: { type: entity, id: seen.id, version: now.getTime() },
              audience: {
                [module === 'hotels' ? 'hotelId' : 'vendorId']: seen.id,
                zoneId: seen.zoneId,
              },
              actor: { type: 'ADMIN', id: ctx.userId },
              data: { stage: to, message },
            },
          },
        ]);
      }
    });
    const after = await this.deps.db.repo.one(ctx, module, seen.id);
    if (!after) throw notFound();
    return item(after, now, message ?? null);
  }
}

const label = (m: OnboardingModule) => (m === 'hotels' ? 'hotel' : 'vendor');
const words = (s: string) => s.replace(/_/g, ' ').toLowerCase();

function item(r: OnboardingRow, now: Date, moreInfoMessage: string | null): OnboardingItem {
  const ageHours = Math.max(0, Math.floor((now.getTime() - r.stageAt.getTime()) / HOUR));
  return {
    module: r.module,
    id: r.id,
    type: r.type,
    name: r.name,
    zone:
      r.zoneId && r.zoneName && r.zoneCode
        ? { id: r.zoneId, name: r.zoneName, code: r.zoneCode }
        : null,
    area: r.area,
    stage: r.stage,
    stageAt: r.stageAt.toISOString(),
    ageHours,
    ageLevel: onboardingAgeLevel(ageHours),
    status: r.status as VendorStatus,
    verificationStatus: r.verificationStatus as VerificationStatus,
    moreInfoMessage: r.stage === 'MORE_INFO_REQUIRED' ? moreInfoMessage : null,
    createdAt: r.createdAt.toISOString(),
  };
}

function counts(
  groups: { stage: string; type: string; age: string; n: number }[],
): OnboardingCounts {
  const zero = <K extends string>(keys: readonly K[]) =>
    Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const out = {
    stage: zero(ONBOARDING_STAGES),
    type: zero(ONBOARDING_TYPES),
    age: zero(ONBOARDING_AGE_LEVELS),
  };
  for (const g of groups) {
    if (g.stage in out.stage) out.stage[g.stage as keyof typeof out.stage] += g.n;
    // type and age tabs count the open queue only (as the list's default)
    if (g.stage === 'DECIDED') continue;
    if (g.type in out.type) out.type[g.type as keyof typeof out.type] += g.n;
    if (g.age in out.age) out.age[g.age as keyof typeof out.age] += g.n;
  }
  return out;
}
