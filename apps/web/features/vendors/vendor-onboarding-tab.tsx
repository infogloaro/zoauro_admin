'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { OnboardingChecklistItem, VendorKind } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSetReviewDeadline, useVendorOnboarding } from './api';

/**
 * A1 Onboarding tab (doc 09 `/onboarding`, doc 45 SLA): the advisory
 * readiness score with per-item explanations plus the review-deadline
 * editor. Nothing here gates activation — D22 verification stays the only
 * gate (owner decision 2026-10-22).
 */

const STATE_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  VERIFIED: 'success',
  EXPIRING_SOON: 'warning',
  PENDING: 'warning',
  MISSING: 'neutral',
  REJECTED: 'danger',
  EXPIRED: 'danger',
};

const STATE_LABELS: Record<string, string> = {
  VERIFIED: 'Verified',
  EXPIRING_SOON: 'Expiring soon',
  PENDING: 'Awaiting verification',
  MISSING: 'Missing',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

const REVIEW_TONES: Record<string, 'success' | 'warning' | 'danger'> = {
  ON_TIME: 'success',
  DUE_SOON: 'warning',
  OVERDUE: 'danger',
  ESCALATED: 'danger',
};

const REVIEW_LABELS: Record<string, string> = {
  ON_TIME: 'On time',
  DUE_SOON: 'Due soon',
  OVERDUE: 'Overdue',
  ESCALATED: 'Escalated',
};

const BAND_LABELS: Record<string, string> = {
  INCOMPLETE: 'Incomplete',
  IN_PROGRESS: 'In progress',
  READY_FOR_REVIEW: 'Ready for review',
};

const BAND_TONES: Record<string, 'success' | 'warning' | 'danger'> = {
  READY_FOR_REVIEW: 'success',
  IN_PROGRESS: 'warning',
  INCOMPLETE: 'danger',
};

/** ISO → value for `<input type="datetime-local">` (local time, minute precision). */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ChecklistRow({ item }: { item: OnboardingChecklistItem }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
      <div>
        <p className="text-sm font-medium text-text">
          {item.label} <span className="text-muted">({item.docType})</span>
        </p>
        <p className="text-xs text-muted">{item.reason}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>
          {item.points}/{item.maxPoints} pts
        </span>
        <Badge tone={STATE_TONES[item.state] ?? 'neutral'}>
          {STATE_LABELS[item.state] ?? item.state}
        </Badge>
      </div>
    </li>
  );
}

export function VendorOnboardingTab({
  vendor,
}: {
  vendor: { kind: VendorKind; id: string; name: string };
}) {
  const onboarding = useVendorOnboarding(vendor.kind, vendor.id);
  const setDeadline = useSetReviewDeadline(vendor.kind);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = onboarding.data?.data;
  const currentDueAt = data?.review.dueAt ?? null;
  const source = data?.review.source ?? 'SLA';

  useEffect(() => {
    setDraft(toLocalInputValue(currentDueAt));
  }, [currentDueAt]);

  async function saveDeadline() {
    setError(null);
    const iso = draft === '' ? null : new Date(draft).toISOString();
    if (draft !== '' && Number.isNaN(new Date(draft).getTime())) {
      setError('Pick a valid date and time.');
      return;
    }
    try {
      await setDeadline.mutateAsync({ id: vendor.id, input: { dueAt: iso } });
      toast.success(
        iso ? 'Review deadline updated' : 'Review deadline cleared — using the 48 h SLA',
      );
      setEditing(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save the deadline.';
      setError(message);
      toast.error(message);
    }
  }

  async function clearDeadline() {
    setError(null);
    try {
      await setDeadline.mutateAsync({ id: vendor.id, input: { dueAt: null } });
      toast.success('Review deadline cleared — using the 48 h SLA');
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not clear the deadline.');
    }
  }

  if (onboarding.isPending) return <TableSkeleton rows={3} />;
  if (onboarding.isError) {
    return (
      <ErrorState
        message={
          onboarding.error instanceof ApiError
            ? onboarding.error.message
            : 'Could not load the onboarding view.'
        }
        requestId={onboarding.error instanceof ApiError ? onboarding.error.requestId : undefined}
        onRetry={() => void onboarding.refetch()}
      />
    );
  }
  if (!data) return <EmptyState message="No onboarding data for this vendor." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-card] border border-border bg-bg p-4">
        <div>
          <p className="text-sm font-medium text-text">
            Readiness{' '}
            <Badge tone={BAND_TONES[data.readiness.band] ?? 'warning'}>
              {BAND_LABELS[data.readiness.band] ?? data.readiness.band}
            </Badge>{' '}
            <span className="text-lg font-semibold text-text">{data.readiness.score}%</span>
          </p>
          {data.readiness.note && <p className="mt-1 text-xs text-muted">{data.readiness.note}</p>}
          <p className="mt-1 text-xs text-muted">
            Advisory only — the checklist never blocks verification or activation.
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium text-text">
            Review{' '}
            <Badge tone={REVIEW_TONES[data.review.state] ?? 'neutral'}>
              {REVIEW_LABELS[data.review.state] ?? data.review.state}
            </Badge>
          </p>
          <p className="mt-1 text-xs text-muted">
            {data.review.dueAt
              ? `Due ${formatDateTime(data.review.dueAt)} · ${source === 'SET' ? 'manual deadline' : '48 h SLA'}`
              : 'Using the 48 h SLA from creation'}
          </p>
        </div>
      </div>

      <div className="rounded-[--radius-card] border border-border bg-bg p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-text">Review deadline</p>
          {editing ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setDraft(toLocalInputValue(currentDueAt));
                }}
                disabled={setDeadline.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void saveDeadline()}
                disabled={setDeadline.isPending}
              >
                Save deadline
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {currentDueAt ? 'Change deadline' : 'Set deadline'}
              </Button>
              {currentDueAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void clearDeadline()}
                  disabled={setDeadline.isPending}
                >
                  Use SLA
                </Button>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="review-deadline">Deadline</Label>
              <Input
                id="review-deadline"
                type="datetime-local"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted">
            {source === 'SET'
              ? 'A manual deadline overrides the default SLA.'
              : 'No manual deadline — overdue is calculated as 48 h after the vendor was created.'}
          </p>
        )}
      </div>

      {data.checklist.length === 0 ? (
        <EmptyState message="No checklist requirements are configured for this vendor type." />
      ) : (
        <ul className="divide-y divide-border rounded-[--radius-card] border border-border">
          {data.checklist.map((item) => (
            <ChecklistRow key={item.docType} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
