import type {
  OnboardingChecklistInput,
  OnboardingChecklistItem,
  OnboardingRemindersResponse,
  OnboardingRequirement,
  SetReviewDeadlineInput,
  VendorKind,
  VendorOnboarding,
  VendorReviewQueueItem,
} from '@zoauro/shared';
import {
  DOC_STATE_POINTS,
  deriveDocState,
  deriveReviewState,
  docStateReason,
  scoreChecklist,
} from '@zoauro/shared';
import { prisma } from '../../lib/db';
import { errors } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { createNotification } from '../notifications/notification.repository';
import * as repo from './vendor.repository';
import { auditModule, entityType, type ActorContext } from './vendor.service';
import type { VendorRowWithZone } from './vendor.types';

/**
 * A1 Smart Vendor Onboarding & Compliance (owner decision 2026-10-22).
 *
 * Advisory matrix: the readiness score and review deadline never block D22
 * verification or activation — they explain how complete a vendor's paperwork
 * is (doc 08, doc 09, doc 45). Writes carry their audit row like every other
 * vendor write (doc 07 §6).
 */

const REVIEW_QUEUE_LIMIT = 50;

async function requireOnboardingRow(kind: VendorKind, id: string): Promise<VendorRowWithZone> {
  const row = await repo.findVendor(kind, id);
  if (!row) throw errors.notFound('Vendor not found');
  return row;
}

function toRequirementDto(row: repo.OnboardingRequirementRow): OnboardingRequirement {
  return {
    // Only RESTAURANT/HOMEMAKER rows are ever read here — the shared contract
    // has no HOTEL variant (hotels have no checklist in A1).
    vendorType: row.vendorType === 'RESTAURANT' ? 'RESTAURANT' : 'HOMEMAKER',
    docType: row.docType as OnboardingRequirement['docType'],
    label: row.label,
    weight: row.weight,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

/* ------------------------------------------------------------------ *
 * Checklist configuration (Super Admin only, doc 09)
 * ------------------------------------------------------------------ */

export async function getOnboardingChecklist(kind: VendorKind): Promise<OnboardingRequirement[]> {
  const rows = await repo.listRequirements(repo.vendorDocumentType(kind));
  return rows.map(toRequirementDto);
}

export async function updateOnboardingChecklist(
  ctx: ActorContext,
  kind: VendorKind,
  input: OnboardingChecklistInput,
): Promise<OnboardingRequirement[]> {
  if (input.kind !== kind) {
    throw errors.validation(
      [{ field: 'kind', issue: `Checklist kind does not match the ${auditModule(kind)} route` }],
      'Checklist kind does not match the route',
    );
  }
  const vendorType = repo.vendorDocumentType(kind);
  const before = (await repo.listRequirements(vendorType)).map(toRequirementDto);

  const after = await prisma.$transaction(async (tx) => {
    await repo.replaceRequirements(
      tx,
      vendorType,
      input.requirements.map((r) => ({
        docType: r.docType,
        label: r.label,
        weight: r.weight,
        active: r.active,
        sortOrder: r.sortOrder,
      })),
    );
    return (await repo.listRequirements(vendorType, tx)).map(toRequirementDto);
  });

  await recordAudit(prisma, {
    actorId: ctx.auth.userId,
    module: auditModule(kind),
    action: `${auditModule(kind)}.onboarding.checklist`,
    entityType: 'onboarding_requirement',
    entityId: vendorType,
    before: { requirements: before },
    after: { requirements: after },
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  });
  return after;
}

/* ------------------------------------------------------------------ *
 * Per-vendor onboarding view
 * ------------------------------------------------------------------ */

function buildChecklist(
  requirements: repo.OnboardingRequirementRow[],
  documents: Array<{
    id: string;
    docType: string;
    fileKey: string;
    verified: boolean;
    rejectionNote: string | null;
    expiresOn: Date | null;
    createdAt: Date;
  }>,
  now: Date,
): { items: OnboardingChecklistItem[]; hasAnyDocument: boolean } {
  const byType = new Map<string, (typeof documents)[number]>();
  for (const doc of documents) {
    const existing = byType.get(doc.docType);
    // Prefer the most recently uploaded document per type.
    if (!existing || doc.createdAt > existing.createdAt) byType.set(doc.docType, doc);
  }
  const items = requirements.map((req) => {
    const doc = byType.get(req.docType) ?? null;
    const state = deriveDocState(
      doc
        ? {
            verified: doc.verified,
            rejectionNote: doc.rejectionNote,
            expiresOn: doc.expiresOn ? doc.expiresOn.toISOString().slice(0, 10) : null,
          }
        : null,
      now,
    );
    return {
      docType: req.docType as OnboardingChecklistItem['docType'],
      label: req.label,
      weight: req.weight,
      active: req.active,
      sortOrder: req.sortOrder,
      state,
      document: doc
        ? {
            id: doc.id,
            docType: doc.docType,
            fileKey: doc.fileKey,
            verified: doc.verified,
            rejectionNote: doc.rejectionNote,
            expiresOn: doc.expiresOn ? doc.expiresOn.toISOString().slice(0, 10) : null,
            createdAt: doc.createdAt.toISOString(),
          }
        : null,
      points: req.weight * DOC_STATE_POINTS[state],
      maxPoints: req.weight,
      reason: docStateReason(
        state,
        doc
          ? {
              verified: doc.verified,
              rejectionNote: doc.rejectionNote,
              expiresOn: doc.expiresOn ? doc.expiresOn.toISOString().slice(0, 10) : null,
            }
          : null,
      ),
    };
  });
  return { items, hasAnyDocument: documents.length > 0 };
}

export async function getVendorOnboarding(kind: VendorKind, id: string): Promise<VendorOnboarding> {
  const row = await requireOnboardingRow(kind, id);
  const [requirements, documents] = await Promise.all([
    repo.listRequirements(repo.vendorDocumentType(kind)),
    repo.listDocuments(kind, id),
  ]);
  const now = new Date();
  const { items, hasAnyDocument } = buildChecklist(
    requirements.filter((r) => r.active),
    documents,
    now,
  );
  return {
    vendorId: row.id,
    kind,
    checklist: items,
    readiness: scoreChecklist(items, { hasAnyDocument }),
    review: deriveReviewState(row.reviewDueAt, row.createdAt, now),
  };
}

/** PUT /{module}/{id}/review-deadline — null clears back to the48 h SLA. */
export async function setVendorReviewDeadline(
  ctx: ActorContext,
  kind: VendorKind,
  id: string,
  input: SetReviewDeadlineInput,
): Promise<VendorOnboarding> {
  const before = await requireOnboardingRow(kind, id);
  const dueAt = input.dueAt === null ? null : new Date(input.dueAt);

  await prisma.$transaction(async (tx) => {
    await repo.updateVendor(tx, kind, id, { reviewDueAt: dueAt });
    await recordAudit(tx, {
      actorId: ctx.auth.userId,
      zoneId: before.zoneId,
      module: auditModule(kind),
      action: `${auditModule(kind)}.review-deadline`,
      entityType: entityType(kind),
      entityId: id,
      before: { reviewDueAt: before.reviewDueAt ? before.reviewDueAt.toISOString() : null },
      after: { reviewDueAt: dueAt ? dueAt.toISOString() : null },
      ip: ctx.auth.ip,
      requestId: ctx.requestId,
    });
  });
  return getVendorOnboarding(kind, id);
}

/* ------------------------------------------------------------------ *
 * Review queue + overdue reminders
 * ------------------------------------------------------------------ */

export async function listReviewQueue(
  kind: VendorKind,
  zoneIds: string[] | null,
): Promise<VendorReviewQueueItem[]> {
  const rows = await repo.listPendingReviewVendors(kind, zoneIds, REVIEW_QUEUE_LIMIT);
  const now = new Date();
  // Readiness stays null in the queue rows — scoring each vendor needs its
  // full document set, which the detail tab already loads on demand.
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind,
    zoneId: row.zoneId,
    zoneName: row.zone.name,
    verificationStatus: row.verificationStatus,
    readinessScore: null,
    readinessBand: null,
    review: deriveReviewState(row.reviewDueAt, row.createdAt, now),
  }));
}

/**
 * POST /{module}/onboarding/reminders — notify Super Admins about vendors
 * whose review is OVERDUE or ESCALATED. Idempotent per vendor per day
 * (`onboarding.overdue.{kind}.{vendorId}.{yyyy-mm-dd}`), so a re-run on the
 * same day dedupes instead of spamming.
 */
export async function sendOnboardingReminders(
  ctx: ActorContext,
  kind: VendorKind,
  zoneIds: string[] | null,
): Promise<OnboardingRemindersResponse> {
  const rows = await repo.listPendingReviewVendors(kind, zoneIds, REVIEW_QUEUE_LIMIT);
  const now = new Date();
  const overdue = rows.filter((row) => {
    const state = deriveReviewState(row.reviewDueAt, row.createdAt, now);
    return state.state === 'OVERDUE' || state.state === 'ESCALATED';
  });
  if (overdue.length === 0) {
    return { scanned: rows.length, overdue: 0, notified: 0, deduped: 0 };
  }

  const recipientIds = await repo.findActiveSuperAdminIds();
  const day = now.toISOString().slice(0, 10);
  let notified = 0;
  let deduped = 0;

  for (const row of overdue) {
    const state = deriveReviewState(row.reviewDueAt, row.createdAt, now);
    for (const recipientId of recipientIds) {
      const created = await createNotification({
        recipientId,
        eventType: 'onboarding.review_overdue',
        title: `Vendor review overdue: ${row.name}`,
        message:
          state.state === 'ESCALATED'
            ? `${row.name} (${auditModule(kind)}) has been waiting more than 48 h past its review deadline.`
            : `${row.name} (${auditModule(kind)}) is past its review deadline.`,
        relatedType: entityType(kind),
        relatedId: row.id,
        navigationTarget: `/${auditModule(kind)}/${row.id}`,
        idempotencyKey: `onboarding.overdue.${kind}.${row.id}.${day}`,
      });
      if (created) notified += 1;
      else deduped += 1;
    }
  }

  await recordAudit(prisma, {
    actorId: ctx.auth.userId,
    module: auditModule(kind),
    action: `${auditModule(kind)}.onboarding.reminders`,
    entityType: auditModule(kind),
    entityId: 'reminders',
    after: { scanned: rows.length, overdue: overdue.length, notified, deduped },
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  });
  return { scanned: rows.length, overdue: overdue.length, notified, deduped };
}
