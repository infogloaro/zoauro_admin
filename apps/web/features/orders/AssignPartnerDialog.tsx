'use client';

import { useQuery } from '@tanstack/react-query';
import { Bike } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert } from '../../components/ui/field';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardSkeleton, EmptyState } from '../dashboard/parts';

// Assign or reassign a delivery partner (doc 20 "Order details", doc 36: only partners of the order's zone; D133: online,
// active, verified, not forced offline; D121: never above the zone's orders-per-partner cap). The list comes from
// GET /delivery-partners?available=true for the order's zone, least busy first; the API checks everything again and
// answers PARTNER_AT_CAPACITY / PARTNER_OFFLINE / … when it changed meanwhile. Sends the order's version (If-Match).

const ISSUE_TEXT: Record<string, string> = {
  PARTNER_AT_CAPACITY:
    'That partner just reached the most orders they can carry at once. Pick another.',
  PARTNER_OFFLINE: 'That partner just went offline. Pick another.',
  PARTNER_NOT_VERIFIED: 'That partner is not verified.',
  PARTNER_NOT_ACTIVE: 'That partner is not active right now. Pick another.',
  PARTNER_OTHER_ZONE: 'That partner belongs to another zone.',
  ALREADY_ASSIGNED: 'This order already has that partner.',
};

export function AssignPartnerDialog({
  order,
  onClose,
  onDone,
}: {
  order: {
    id: string;
    orderNo: string;
    zoneId: string;
    version: number;
    deliveryPartnerId: string | null;
  };
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const client = useApiClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const partners = useQuery({
    queryKey: ['partners', 'available', order.zoneId],
    queryFn: ({ signal }) =>
      client.get('/delivery-partners', {
        query: { zoneId: [order.zoneId], available: 'true', sort: 'currentOrders', pageSize: 50 },
        signal,
      }),
    staleTime: 10_000,
  });
  const rows = (partners.data?.data ?? []).filter((p) => p.id !== order.deliveryPartnerId);
  const reassign = order.deliveryPartnerId !== null;

  const assign = async () => {
    if (!picked) return;
    setBusy(true);
    setAlert(null);
    try {
      await client.post('/orders/{id}/assign', {
        params: { id: order.id },
        body: { deliveryPartnerId: picked },
        ifMatch: order.version,
      });
      toast({ title: `${reassign ? 'Reassigned' : 'Assigned'}: order ${order.orderNo}` });
      await onDone();
    } catch (err) {
      const issue = isApiError(err) ? err.details[0]?.issue : undefined;
      setAlert(
        isApiError(err, 'STALE_VERSION')
          ? 'This order changed a moment ago. Close and check it again.'
          : ((issue && ISSUE_TEXT[issue]) ??
              (isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN)),
      );
      void partners.refetch();
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <div>
          <DialogTitle>
            {reassign ? 'Reassign' : 'Assign'} a partner to order {order.orderNo}
          </DialogTitle>
          <DialogDescription>
            Online, verified partners of this order&apos;s zone, least busy first.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {partners.isError ? (
          <FormAlert>The partners could not be loaded. Close and try again.</FormAlert>
        ) : !partners.data ? (
          <CardSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bike aria-hidden className="size-5" />}
            title="Nobody available right now"
          >
            No other partner of this zone is online and free. Try again in a moment.
          </EmptyState>
        ) : (
          <fieldset className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            <legend className="sr-only">Partner</legend>
            {rows.map((p) => {
              const full =
                p.maxConcurrentOrders !== null && p.currentOrders >= p.maxConcurrentOrders;
              return (
                <label
                  key={p.id}
                  className={cn(
                    'flex items-center gap-3 rounded-input border p-3 text-sm',
                    picked === p.id ? 'border-primary bg-primary-soft' : 'border-line',
                    full && 'opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="partner"
                    value={p.id}
                    disabled={full}
                    checked={picked === p.id}
                    onChange={() => setPicked(p.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {[p.vehicleType, p.vehicleNo, p.area].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {p.currentOrders}
                    {p.maxConcurrentOrders !== null ? ` of ${p.maxConcurrentOrders}` : ''} order
                    {p.currentOrders === 1 ? '' : 's'}
                    {full ? ' · full' : ''}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void assign()} disabled={busy || !picked}>
            {reassign ? 'Reassign' : 'Assign'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
