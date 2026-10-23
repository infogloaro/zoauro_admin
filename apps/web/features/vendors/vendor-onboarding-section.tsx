'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { VendorKind, VendorReviewQueueItem } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useOnboardingQueue, useOnboardingReminders } from './api';
import { ChecklistConfigDialog } from './checklist-config-dialog';

/**
 * A1 "Needs review" section (doc 09 `/onboarding/review-queue` +
 * `/onboarding/reminders`, doc 45): pending-verification vendors ordered
 * oldest-first with their review state, plus a one-click reminder run that
 * is idempotent per vendor per day.
 */

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

function ReviewCell({ review }: { review: VendorReviewQueueItem['review'] }) {
  return (
    <div className="text-sm">
      <Badge tone={REVIEW_TONES[review.state] ?? 'neutral'}>
        {REVIEW_LABELS[review.state] ?? review.state}
      </Badge>
      <p className="mt-1 text-xs text-muted">
        {review.dueAt ? `Due ${formatDateTime(review.dueAt)}` : 'No deadline — SLA from creation'}
      </p>
    </div>
  );
}

export function VendorOnboardingSection({
  kind,
  zoneId,
  onOpenVendor,
}: {
  kind: VendorKind;
  zoneId?: string;
  onOpenVendor: (id: string) => void;
}) {
  const queue = useOnboardingQueue(kind, zoneId);
  const reminders = useOnboardingReminders(kind);
  const [configOpen, setConfigOpen] = useState(false);

  async function sendReminders() {
    try {
      const { data } = await reminders.mutateAsync();
      if (data.overdue === 0) {
        toast.success('No overdue reviews — nothing to remind.');
      } else {
        toast.success(
          `Reminders sent for ${data.notified} ${data.notified === 1 ? 'review' : 'reviews'}${data.deduped > 0 ? ` (${data.deduped} already notified today)` : ''}`,
        );
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not send reminders.');
    }
  }

  const rows = queue.data?.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-text">Needs review</h2>
          <p className="text-[13px] text-muted">
            Pending-verification vendors with their onboarding review deadline (doc 45).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
            Manage checklist
          </Button>
          <Button size="sm" onClick={() => void sendReminders()} disabled={reminders.isPending}>
            {reminders.isPending ? 'Sending…' : 'Send reminders'}
          </Button>
        </div>
      </div>

      {queue.isPending ? (
        <TableSkeleton />
      ) : queue.isError ? (
        <ErrorState
          message={
            queue.error instanceof ApiError
              ? queue.error.message
              : 'Could not load the review queue.'
          }
          requestId={queue.error instanceof ApiError ? queue.error.requestId : undefined}
          onRetry={() => void queue.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState message="No vendors are waiting for review." />
      ) : (
        <ul className="divide-y divide-border rounded-[--radius-card] border border-border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <button
                  type="button"
                  onClick={() => onOpenVendor(row.id)}
                  className="text-sm font-medium text-text hover:text-orange-500 hover:underline"
                >
                  {row.name}
                </button>
                <p className="text-xs text-muted">
                  {kind === 'restaurant' ? 'Restaurant' : 'Home food provider'} · {row.zoneName}
                </p>
              </div>
              <ReviewCell review={row.review} />
            </li>
          ))}
        </ul>
      )}

      {configOpen && <ChecklistConfigDialog kind={kind} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
