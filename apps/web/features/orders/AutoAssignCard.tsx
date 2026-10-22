'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@zoauro/shared';
import { Bot, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { FormAlert } from '../../components/ui/field';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { relativeTime } from '../dashboard/time';
import { useInvalidateOrders } from './api';

// Auto-assign on the order page (D154, D199): the zone's setting, the engine's tries and the partner it picked, and
// "Try auto-assign again" (POST /orders/{id}/auto-assign, orders:edit in the zone). Refreshes every 10 s while the
// order is READY and the zone has it on, so the assignment shows up without a reload.

const POLL_MS = 10_000;

/** "1.2 km" / "850 m" (Indian grouping for the metres) */
export function distanceText(m: number): string {
  return m < 1000 ? `${m.toLocaleString('en-IN')} m` : `${(m / 1000).toFixed(1)} km`;
}

export function AutoAssignCard({
  orderId,
  status,
  version,
  canAssign,
}: {
  orderId: string;
  status: OrderStatus;
  version: number;
  /** the order's own "assign" action (acts.canAssign): the member may assign in this zone */
  canAssign: boolean;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateOrders();
  const { toast } = useToast();
  const [alert, setAlert] = useState<string | null>(null);
  const state = useQuery({
    queryKey: ['orders', 'auto-assign', orderId],
    queryFn: ({ signal }) =>
      client.get('/orders/{id}/auto-assign', { params: { id: orderId }, signal }),
    refetchInterval: (q) => (status === 'READY' && q.state.data?.setting.enabled ? POLL_MS : false),
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
  const lastOutcome = state.data?.state?.lastOutcome ?? null;
  const run = useMutation({
    mutationFn: () =>
      client.post('/orders/{id}/auto-assign', {
        params: { id: orderId },
        body: {},
        ifMatch: version,
      }),
    onSuccess: (r) => {
      setAlert(null);
      toast(
        r.outcome === 'ASSIGNED'
          ? {
              title: `Assigned to ${r.offer?.partnerName ?? 'a partner'}`,
              ...(r.offer
                ? { description: `${distanceText(r.offer.distanceM)} from the pickup` }
                : {}),
            }
          : {
              tone: 'info',
              title: 'No partner free nearby',
              description:
                r.outcome === 'FALLBACK'
                  ? 'Assign a partner by hand.'
                  : 'Auto-assign tries again shortly.',
            },
      );
    },
    onError: (err) => setAlert(failure(err)),
    onSettled: () => void invalidate(),
  });

  if (state.isError)
    return (
      <Card aria-labelledby="order-auto-assign">
        <CardHeader id="order-auto-assign" title="Automatic assignment" />
        <CardBody className="flex items-center gap-3 text-sm">
          <span className="text-muted">The auto-assign details could not be loaded.</span>
          <Button size="sm" variant="secondary" onClick={() => void state.refetch()}>
            Retry
          </Button>
        </CardBody>
      </Card>
    );
  if (!state.data) return null; // the order page shows its own skeleton; this card appears when ready
  const { setting, state: tries, offers } = state.data;
  // a zone with it off and nothing tried: one quiet line only while the order waits for a partner
  if (!setting.enabled && offers.length === 0 && status !== 'READY') return null;

  const canRun = canAssign && setting.enabled && status === 'READY';
  return (
    <Card aria-labelledby="order-auto-assign">
      <CardHeader
        id="order-auto-assign"
        title="Automatic assignment"
        subtitle={
          setting.enabled
            ? `On · nearest free partner within ${setting.radiusKm} km · retry after ${setting.offerTimeoutSeconds} s, ${setting.maxAttempts} ${setting.maxAttempts === 1 ? 'try' : 'tries'}`
            : 'Off for this zone · partners are assigned by hand'
        }
        actions={
          canRun ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              <RotateCcw aria-hidden className="size-4" /> Try auto-assign again
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {tries?.fallbackAt && status === 'READY' ? (
          <FormAlert>
            No partner found after {tries.attempts} {tries.attempts === 1 ? 'try' : 'tries'}. Assign
            a partner by hand.
          </FormAlert>
        ) : null}
        {tries ? (
          <p className="text-muted">
            {tries.attempts} {tries.attempts === 1 ? 'try' : 'tries'}
            {lastOutcome === 'NO_PARTNER' && !tries.fallbackAt && status === 'READY'
              ? ` · nobody free yet; next try ${relativeTime(tries.nextAttemptAt)}`
              : ''}
          </p>
        ) : setting.enabled && status === 'READY' ? (
          <p className="text-muted">Waiting for the first try (within about 10 seconds).</p>
        ) : null}
        {offers.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Partners picked">
            {offers.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <Bot aria-hidden className="size-4 text-muted" />
                <span className="font-semibold">{f.partnerName}</span>
                <span className="text-muted">
                  {distanceText(f.distanceM)} from the pickup · {relativeTime(f.offeredAt)}
                </span>
                <Badge tone={f.status === 'ACCEPTED' ? 'success' : 'neutral'}>
                  {f.status === 'ACCEPTED' ? 'Assigned by the system' : f.status.toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

function failure(err: unknown): string {
  if (!isApiError(err)) return TRY_AGAIN;
  const issue = err.details?.[0]?.issue;
  if (err.code === 'STALE_VERSION')
    return 'The order changed meanwhile. It has been refreshed; try again.';
  if (issue === 'AUTO_ASSIGN_OFF') return 'Auto-assign is off for this zone.';
  if (issue === 'NOT_READY') return 'Only a ready order without a partner can be auto-assigned.';
  return err.message || TRY_AGAIN;
}
