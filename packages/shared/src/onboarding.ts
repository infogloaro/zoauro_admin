import { z } from 'zod';
import { VENDOR_DOC_TYPES, VENDOR_KINDS } from './vendor';

/**
 * A1 Smart Vendor Onboarding & Compliance (owner decision 2026-10-22).
 *
 * Advisory matrix: nothing here is a hard activation gate — D22 verification
 * stays the only gate. Missing or stale documents lower the readiness score
 * and are explained per item. Sources: doc 08 (onboarding_requirements,
 * expires_on, review_due_at), doc 09 (endpoints), doc 45 (review SLA 48 h).
 */

export const ONBOARDING_DOC_STATES = [
  'MISSING',
  'PENDING',
  'REJECTED',
  'EXPIRED',
  'EXPIRING_SOON',
  'VERIFIED',
] as const;
export type OnboardingDocState = (typeof ONBOARDING_DOC_STATES)[number];

export const REVIEW_STATES = ['ON_TIME', 'DUE_SOON', 'OVERDUE', 'ESCALATED'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const READINESS_BANDS = ['INCOMPLETE', 'IN_PROGRESS', 'READY_FOR_REVIEW'] as const;
export type ReadinessBand = (typeof READINESS_BANDS)[number];

/** Doc 45: escalate reviews that sit past due for more than 48 h. */
export const REVIEW_SLA_HOURS = 48;
/** Warn when a document expires within 30 days. */
export const DOC_EXPIRY_WARNING_DAYS = 30;
/** Band thresholds for the readiness score. */
export const READINESS_IN_PROGRESS_MIN = 50;
export const READINESS_READY_MIN = 80;

/** Fraction of the item weight credited per state (advisory only). */
export const DOC_STATE_POINTS: Record<OnboardingDocState, number> = {
  VERIFIED: 1,
  EXPIRING_SOON: 0.75,
  PENDING: 0.5,
  REJECTED: 0,
  EXPIRED: 0,
  MISSING: 0,
};

/* ------------------------------------------------------------------ *
 * Checklist requirements (Super Admin configures, doc 09)
 * ------------------------------------------------------------------ */

export const onboardingRequirementSchema = z.object({
  vendorType: z.enum(['RESTAURANT', 'HOMEMAKER']),
  docType: z.enum(VENDOR_DOC_TYPES),
  label: z.string().trim().min(1).max(80),
  weight: z.number().int().min(0).max(100),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(99),
});

export type OnboardingRequirement = z.infer<typeof onboardingRequirementSchema>;

export const onboardingChecklistInputSchema = z
  .object({
    kind: z.enum(VENDOR_KINDS),
    requirements: z
      .array(
        z.object({
          docType: z.enum(VENDOR_DOC_TYPES),
          label: z.string().trim().min(1, 'Label is required').max(80),
          weight: z.number().int().min(0).max(100),
          active: z.boolean(),
          sortOrder: z.number().int().min(0).max(99),
        }),
      )
      .min(1, 'Add at least one requirement')
      .max(10),
  })
  .refine((v) => new Set(v.requirements.map((r) => r.docType)).size === v.requirements.length, {
    error: 'Each document type can appear only once',
    path: ['requirements'],
  });

export type OnboardingChecklistInput = z.infer<typeof onboardingChecklistInputSchema>;

/** PUT /{module}/{id}/review-deadline — null clears back to the SLA default. */
export const setReviewDeadlineSchema = z.object({
  dueAt: z.iso.datetime({ offset: true }).nullable(),
});

export type SetReviewDeadlineInput = z.infer<typeof setReviewDeadlineSchema>;

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export const onboardingDocumentRefSchema = z.object({
  id: z.uuid(),
  docType: z.string(),
  fileKey: z.string(),
  verified: z.boolean(),
  rejectionNote: z.string().nullable(),
  expiresOn: z.string().nullable(),
  createdAt: z.string(),
});

export type OnboardingDocumentRef = z.infer<typeof onboardingDocumentRefSchema>;

export const onboardingChecklistItemSchema = z.object({
  docType: z.enum(VENDOR_DOC_TYPES),
  label: z.string(),
  weight: z.number().int(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  state: z.enum(ONBOARDING_DOC_STATES),
  document: onboardingDocumentRefSchema.nullable(),
  points: z.number(),
  maxPoints: z.number(),
  reason: z.string(),
});

export type OnboardingChecklistItem = z.infer<typeof onboardingChecklistItemSchema>;

export const onboardingReadinessSchema = z.object({
  score: z.number().int().min(0).max(100),
  band: z.enum(READINESS_BANDS),
  provisional: z.boolean(),
  note: z.string().nullable(),
  earnedPoints: z.number(),
  maxPoints: z.number(),
});

export type OnboardingReadiness = z.infer<typeof onboardingReadinessSchema>;

export const reviewStateSchema = z.object({
  dueAt: z.string().nullable(),
  source: z.enum(['SET', 'SLA']),
  state: z.enum(REVIEW_STATES),
  dueInHours: z.number().nullable(),
});

export type ReviewStateOutput = z.infer<typeof reviewStateSchema>;

export const vendorOnboardingSchema = z.object({
  vendorId: z.uuid(),
  kind: z.enum(VENDOR_KINDS),
  checklist: z.array(onboardingChecklistItemSchema),
  readiness: onboardingReadinessSchema,
  review: reviewStateSchema,
});

export type VendorOnboarding = z.infer<typeof vendorOnboardingSchema>;

export const onboardingRemindersResponseSchema = z.object({
  scanned: z.number().int(),
  overdue: z.number().int(),
  notified: z.number().int(),
  deduped: z.number().int(),
});

export type OnboardingRemindersResponse = z.infer<typeof onboardingRemindersResponseSchema>;

/** Queue row for the vendors screen "Needs review" section. */
export const vendorReviewQueueItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(VENDOR_KINDS),
  zoneId: z.uuid(),
  zoneName: z.string(),
  verificationStatus: z.string(),
  readinessScore: z.number().int().nullable(),
  readinessBand: z.enum(READINESS_BANDS).nullable(),
  review: reviewStateSchema,
});

export type VendorReviewQueueItem = z.infer<typeof vendorReviewQueueItemSchema>;

/* ------------------------------------------------------------------ *
 * Pure helpers (unit-tested; no DB, no clock of their own)
 * ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DocumentLike {
  verified: boolean;
  rejectionNote: string | null;
  expiresOn: string | null;
}

/** Precedence: MISSING → REJECTED → EXPIRED → EXPIRING_SOON → VERIFIED → PENDING. */
export function deriveDocState(doc: DocumentLike | null, now: Date): OnboardingDocState {
  if (!doc) return 'MISSING';
  if (!doc.verified && doc.rejectionNote !== null) return 'REJECTED';
  if (doc.expiresOn !== null) {
    const expiresAt = new Date(`${doc.expiresOn}T00:00:00.000Z`).getTime();
    if (Number.isFinite(expiresAt)) {
      if (expiresAt < now.getTime()) return 'EXPIRED';
      if (expiresAt - now.getTime() <= DOC_EXPIRY_WARNING_DAYS * DAY_MS) return 'EXPIRING_SOON';
    }
  }
  return doc.verified ? 'VERIFIED' : 'PENDING';
}

export interface ScoreInput {
  state: OnboardingDocState;
  weight: number;
  active: boolean;
}

export type ScoreResult = OnboardingReadiness;

/** Weighted readiness score; `provisional` when no active requirement exists. */
export function scoreChecklist(
  items: readonly ScoreInput[],
  opts: { hasAnyDocument?: boolean } = {},
): ScoreResult {
  const active = items.filter((i) => i.active);
  const maxPoints = active.reduce((sum, i) => sum + i.weight, 0);
  const earnedPoints = active.reduce((sum, i) => sum + i.weight * DOC_STATE_POINTS[i.state], 0);
  const hasAnyDocument = opts.hasAnyDocument ?? items.some((i) => i.state !== 'MISSING');
  if (maxPoints === 0) {
    return {
      score: 0,
      band: 'INCOMPLETE',
      provisional: true,
      note: 'No active requirements configured — score is provisional',
      earnedPoints: 0,
      maxPoints: 0,
    };
  }
  const score = Math.round((earnedPoints / maxPoints) * 100);
  const band: ReadinessBand =
    score >= READINESS_READY_MIN
      ? 'READY_FOR_REVIEW'
      : score >= READINESS_IN_PROGRESS_MIN
        ? 'IN_PROGRESS'
        : 'INCOMPLETE';
  const provisional = !hasAnyDocument;
  const note = provisional
    ? 'No documents uploaded yet — score is provisional'
    : band === 'READY_FOR_REVIEW'
      ? 'Document checklist is nearly complete'
      : null;
  return { score, band, provisional, note, earnedPoints, maxPoints };
}

/** Effective review deadline: explicit `review_due_at` wins over the48 h SLA. */
export function deriveReviewState(
  reviewDueAt: string | Date | null,
  createdAt: string | Date,
  now: Date,
): ReviewStateOutput {
  const created = new Date(createdAt).getTime();
  const source = reviewDueAt === null ? 'SLA' : 'SET';
  const due =
    reviewDueAt === null
      ? created + REVIEW_SLA_HOURS * 3600 * 1000
      : new Date(reviewDueAt).getTime();
  const dueIso = Number.isFinite(due) ? new Date(due).toISOString() : null;
  const dueInHours = Number.isFinite(due)
    ? Math.round(((due - now.getTime()) / 3600000) * 10) / 10
    : null;
  if (dueInHours === null || dueInHours > 24) {
    return { dueAt: dueIso, source, state: 'ON_TIME', dueInHours };
  }
  if (dueInHours > 0) return { dueAt: dueIso, source, state: 'DUE_SOON', dueInHours };
  if (dueInHours > -REVIEW_SLA_HOURS)
    return { dueAt: dueIso, source, state: 'OVERDUE', dueInHours };
  return { dueAt: dueIso, source, state: 'ESCALATED', dueInHours };
}

/** Human-readable reason for a checklist item state. */
export function docStateReason(state: OnboardingDocState, doc: DocumentLike | null): string {
  switch (state) {
    case 'MISSING':
      return 'No document uploaded';
    case 'PENDING':
      return 'Awaiting verification';
    case 'REJECTED':
      return `Rejected: ${doc?.rejectionNote ?? 'no note'}`;
    case 'EXPIRED':
      return `Expired on ${doc?.expiresOn ?? 'unknown date'}`;
    case 'EXPIRING_SOON':
      return `Expires on ${doc?.expiresOn ?? 'unknown date'}`;
    case 'VERIFIED':
      return 'Verified';
  }
}
