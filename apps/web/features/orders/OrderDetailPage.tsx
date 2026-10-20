'use client';

import type { OrderDetail } from '@zoauro/shared';
import { Ban, ChevronRight, MapPin, Package, Store, User } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { formatPaise, formatTimestamp } from '../audit/format';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { useOrder, useOrderAction } from './api';
import {
  CANCEL_REASONS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  TRANSITION_LABEL,
} from './format';

// Order detail (doc 34 SA-4.4, doc 20 Order details): items and amounts, customer (phone masked), vendor, partner,
// address, payments and the status timeline. The buttons are the moves the API says this admin may make now; each one
// sends the version on screen, so a change made meanwhile by someone else is refused and the page reloads.

function friendlyError(err: unknown): string {
  if (isApiError(err, 'STALE_VERSION'))
    return 'Someone changed this order a moment ago. The latest version is shown now; check it and try again.';
  if (isApiError(err, 'INVALID_STATE_TRANSITION'))
    return 'This order can no longer make that move. The latest version is shown now.';
  if (isApiError(err, 'FORBIDDEN'))
    return 'You do not have permission to change orders in this zone.';
  if (isApiError(err, 'NOT_FOUND')) return 'This order is no longer available.';
  return TRY_AGAIN;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: (reasonCode: string, note: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const needsNote = reason === 'OTHER';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Cancel this order?</DialogTitle>
        <DialogDescription>
          The customer, the vendor and the delivery partner are told. If the order was paid online,
          a refund is expected. This cannot be undone.
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason && (!needsNote || note.trim())) onConfirm(reason, note.trim());
          }}
        >
          <FormField label="Reason">
            <select
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 rounded-input border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Choose a reason</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={needsNote ? 'Details' : 'Details (optional)'}>
            <textarea
              value={note}
              maxLength={500}
              required={needsNote}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={inputClass('h-auto py-2')}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Keep order
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={busy || !reason || (needsNote && !note.trim())}
            >
              <Ban aria-hidden className="size-4" /> Cancel order
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Actions({ order }: { order: OrderDetail }) {
  const action = useOrderAction(order);
  const { toast } = useToast();
  const [cancelling, setCancelling] = useState(false);
  const reload = useOrder(order.id);

  const run = (a: Parameters<typeof action.mutate>[0], done: string) =>
    action.mutate(a, {
      onSuccess: () => {
        setCancelling(false);
        toast({ tone: 'success', title: done });
      },
      onError: (err) => {
        toast({ tone: 'error', title: 'Not changed', description: friendlyError(err) });
        if (isApiError(err, 'STALE_VERSION') || isApiError(err, 'INVALID_STATE_TRANSITION'))
          void reload.refetch();
      },
    });

  if (order.actions.transitions.length === 0 && !order.actions.cancel) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {order.actions.transitions.map((to) => (
        <Button
          key={to}
          disabled={action.isPending}
          onClick={() =>
            run({ kind: 'transition', to }, `Order is now ${ORDER_STATUS_LABEL[to].toLowerCase()}`)
          }
        >
          {TRANSITION_LABEL[to]} <ChevronRight aria-hidden className="size-4" />
        </Button>
      ))}
      {order.actions.cancel ? (
        <Button variant="secondary" disabled={action.isPending} onClick={() => setCancelling(true)}>
          <Ban aria-hidden className="size-4" /> Cancel order
        </Button>
      ) : null}
      <CancelDialog
        open={cancelling}
        onOpenChange={setCancelling}
        busy={action.isPending}
        onConfirm={(reasonCode, note) =>
          run({ kind: 'cancel', reasonCode, ...(note ? { note } : {}) }, 'Order cancelled')
        }
      />
    </div>
  );
}

export function OrderDetailPage({
  id,
  listHref,
  homeHref,
}: {
  id: string;
  listHref: string;
  homeHref: string;
}) {
  const order = useOrder(id);
  const o = order.data;

  return (
    <div>
      <PageHeader
        title={o ? `Order ${o.orderNo}` : 'Order'}
        crumbs={[
          { label: 'Dashboard', href: homeHref },
          { label: 'Orders', href: listHref },
          { label: o?.orderNo ?? 'Order' },
        ]}
        badge={
          o ? (
            <Badge tone={ORDER_STATUS_TONE[o.status]} dot>
              {ORDER_STATUS_LABEL[o.status]}
            </Badge>
          ) : undefined
        }
        description={o ? `Placed ${formatTimestamp(o.placedAt)} · ${o.zoneName}` : undefined}
        actions={o ? <Actions order={o} /> : undefined}
      />

      {order.isError ? (
        isApiError(order.error, 'NOT_FOUND') ? (
          <Card className="p-6">
            <p className="font-semibold">Order not found</p>
            <p className="mt-1 text-sm text-muted">
              It does not exist, or it belongs to a zone you cannot see.{' '}
              <a href={listHref} className="text-primary-strong underline">
                Back to orders
              </a>
            </p>
          </Card>
        ) : (
          <CardError what="This order" onRetry={() => void order.refetch()} />
        )
      ) : !o ? (
        <CardSkeleton rows={8} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <Package aria-hidden className="size-4 text-muted" /> Items
              </h2>
              <table className="w-full text-sm">
                <caption className="sr-only">Items</caption>
                <thead className="text-left text-xs text-muted uppercase">
                  <tr>
                    <th scope="col" className="py-2">
                      Item
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Price
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Qty
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2">{i.name}</td>
                      <td className="py-2 text-right tabular-nums">{formatPaise(i.price)}</td>
                      <td className="py-2 text-right tabular-nums">{i.qty}</td>
                      <td className="py-2 text-right tabular-nums">{formatPaise(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 border-t border-line pt-2">
                <Row label="Subtotal" value={formatPaise(o.subtotal)} />
                <Row label="Tax" value={formatPaise(o.tax)} />
                <Row label="Delivery charge" value={formatPaise(o.deliveryCharge)} />
                {o.discount > 0 ? (
                  <Row label="Discount" value={`− ${formatPaise(o.discount)}`} />
                ) : null}
                <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatPaise(o.total)}</dd>
                </div>
              </dl>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Timeline</h2>
              <ol className="flex flex-col gap-3 text-sm">
                <li className="flex gap-3">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <span>
                    <span className="block font-medium">Placed</span>
                    <span className="text-xs text-muted">{formatTimestamp(o.placedAt)}</span>
                  </span>
                </li>
                {o.timeline.map((t) => (
                  <li key={t.id} className="flex gap-3">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    <span>
                      <span className="block font-medium">
                        {ORDER_STATUS_LABEL[t.to]}
                        <span className="font-normal text-muted">
                          {' '}
                          · by {t.actorType.toLowerCase()}
                        </span>
                      </span>
                      <span className="text-xs text-muted">{formatTimestamp(t.createdAt)}</span>
                      {t.note ? <span className="block text-xs">“{t.note}”</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              {o.cancelReason ? (
                <p className="mt-4 rounded-input bg-danger-soft px-3 py-2 text-sm text-danger">
                  Cancelled: {o.cancelReason}
                </p>
              ) : null}
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <User aria-hidden className="size-4 text-muted" /> Customer
              </h2>
              <p className="font-medium">{o.customer.name}</p>
              <p className="text-sm text-muted">{o.customer.phone}</p>
              {o.address ? (
                <p className="mt-3 flex gap-2 text-sm">
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                  {o.address}
                </p>
              ) : null}
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <Store aria-hidden className="size-4 text-muted" />
                {o.vendorType === 'restaurant' ? 'Restaurant' : 'Home Food'}
              </h2>
              <p className="font-medium">{o.vendor.name}</p>
              <p className="mt-3 text-sm text-muted">Delivery partner</p>
              <p className="text-sm">{o.deliveryPartner?.name ?? 'Not assigned yet'}</p>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Payment</h2>
              <dl>
                <Row label="Method" value={PAYMENT_METHOD_LABEL[o.paymentMethod]} />
                <div className="flex justify-between gap-4 py-1.5 text-sm">
                  <dt className="text-muted">Status</dt>
                  <dd>
                    <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                      {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                    </Badge>
                  </dd>
                </div>
              </dl>
              {o.payments.length > 0 ? (
                <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
                  {o.payments.map((p) => (
                    <li key={p.id} className="flex justify-between py-2">
                      <span>
                        {p.provider}
                        <span className="block text-xs text-muted">
                          {formatTimestamp(p.createdAt)}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        {formatPaise(p.amount)}
                        <span className="block text-xs text-muted">
                          {PAYMENT_STATUS_LABEL[p.status]}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
