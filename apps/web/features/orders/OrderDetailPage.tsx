'use client';

import type { OrderStatus } from '@zoauro/shared';
import { Ban, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { formatPaise } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useInvalidateOrders, useOrderDetail } from './api';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  orderActions,
} from './labels';

// One order (doc 20 "Order details", SA-4.4, ZA-4.2; doc 10 state machine): status with the moves it allows, items,
// amounts, customer (masked, D26), vendor, partner, payments and the status timeline. Every write sends the version the
// screen shows (If-Match); if someone changed the order meanwhile the API answers 409 STALE_VERSION and the screen
// reloads it. Assigning a partner waits for the partner picker (M10).

const failure = (err: unknown): string => {
  if (isApiError(err, 'STALE_VERSION'))
    return 'This order changed a moment ago. It has been reloaded; check it and try again.';
  if (isApiError(err)) return err.message || TRY_AGAIN;
  return TRY_AGAIN;
};

export function OrderDetailPage({
  id,
  role,
  can,
}: {
  id: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** orders:status (moves, cancel) somewhere; the API decides per zone */
  can: { status: boolean };
}) {
  const client = useApiClient();
  const detail = useOrderDetail(id);
  const invalidate = useInvalidateOrders();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const listPath = role === 'SUPER_ADMIN' ? '/super-admin/orders' : '/zone/orders';

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Order"
          crumbs={[{ label: 'Orders', href: listPath }, { label: 'Not found' }]}
        />
        <CardError what="This order" onRetry={() => void detail.refetch()} />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={8} />;
  const o = detail.data;
  const acts = orderActions(o.status);

  const move = async (to: OrderStatus) => {
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/orders/{id}/transition', {
        params: { id: o.id },
        body: { to },
        ifMatch: o.version,
      });
      toast({ title: `Order ${o.orderNo}: ${ORDER_STATUS_LABEL[to]}` });
    } catch (err) {
      setAlert(failure(err));
    } finally {
      await invalidate();
      setBusy(false);
    }
  };

  const amounts: [string, number][] = [
    ['Items', o.subtotal],
    ['Tax', o.tax],
    ['Delivery', o.deliveryCharge],
    ['Discount', -o.discount],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Order ${o.orderNo}`}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Orders', href: listPath },
          { label: o.orderNo },
        ]}
        description={`Placed ${relativeTime(o.placedAt)} · ${new Date(o.placedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}
      />

      <Card aria-labelledby="order-status">
        <CardHeader
          id="order-status"
          title="Status"
          actions={
            <Badge tone={ORDER_STATUS_TONE[o.status]} dot>
              {ORDER_STATUS_LABEL[o.status]}
            </Badge>
          }
        />
        <CardBody className="flex flex-col gap-3">
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          {can.status && (acts.moves.length > 0 || acts.canCancel || acts.canUnassign) ? (
            <div className="flex flex-wrap gap-2">
              {acts.moves.map((m) => (
                <Button key={m.to} disabled={busy} onClick={() => void move(m.to)}>
                  {m.label}
                </Button>
              ))}
              {acts.canUnassign ? (
                <Button variant="secondary" disabled={busy} onClick={() => void move('READY')}>
                  <Undo2 aria-hidden className="size-4" /> Unassign partner
                </Button>
              ) : null}
              {acts.canCancel ? (
                <Button variant="danger" disabled={busy} onClick={() => setCancelling(true)}>
                  <Ban aria-hidden className="size-4" /> Cancel order
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">
              {o.status === 'DELIVERED' || o.status === 'CANCELLED' || o.status === 'REFUNDED'
                ? 'This order is closed. Refunds are handled by the Refunds module.'
                : 'No action for you on this order.'}
            </p>
          )}
          {acts.canAssign && o.status === 'READY' ? (
            <p className="text-xs text-muted">
              Assigning a delivery partner arrives with the Delivery Partners module.
            </p>
          ) : null}
          {o.cancelReason ? <p className="text-sm">Cancel reason: “{o.cancelReason}”</p> : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" aria-labelledby="order-items">
          <CardHeader
            id="order-items"
            title="Items"
            subtitle={`${o.itemCount} item${o.itemCount === 1 ? '' : 's'} from ${o.vendorName}`}
          />
          <CardBody>
            <table className="w-full text-sm">
              <caption className="sr-only">Items</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1.5 font-medium">
                    Item
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Qty
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Price
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {o.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2">{it.name}</td>
                    <td className="py-2 text-right tabular-nums">{it.qty}</td>
                    <td className="py-2 text-right tabular-nums">{formatPaise(it.price)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPaise(it.price * it.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 ml-auto grid max-w-xs gap-1 text-sm">
              {amounts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="tabular-nums">{formatPaise(v)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPaise(o.total)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card aria-labelledby="order-people">
            <CardHeader id="order-people" title="Customer and delivery" />
            <CardBody>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Customer</dt>
                  <dd>
                    {o.customer.name} ·{' '}
                    <span className="tabular-nums">{o.customer.phoneMasked}</span>
                    {o.customer.emailMasked ? ` · ${o.customer.emailMasked}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Vendor</dt>
                  <dd>{o.vendorName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Delivery partner</dt>
                  <dd>{o.deliveryPartner?.name ?? 'Not assigned'}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card aria-labelledby="order-payment">
            <CardHeader
              id="order-payment"
              title="Payment"
              actions={
                <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                  {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                </Badge>
              }
            />
            <CardBody>
              <p className="text-sm">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</p>
              {o.payments.length > 0 ? (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {o.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 py-1.5">
                      <span>
                        {p.provider}
                        {p.method ? ` · ${p.method}` : ''}
                      </span>
                      <span className="tabular-nums">{formatPaise(p.amount)}</span>
                      <Badge tone={PAYMENT_STATUS_TONE[p.status]}>
                        {PAYMENT_STATUS_LABEL[p.status]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card aria-labelledby="order-timeline">
        <CardHeader
          id="order-timeline"
          title="Timeline"
          subtitle="Every status change, oldest first"
        />
        <CardBody>
          <ol className="flex flex-col gap-3">
            {o.timeline.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Badge tone={ORDER_STATUS_TONE[t.to]} dot>
                  {ORDER_STATUS_LABEL[t.to]}
                </Badge>
                <span className="text-muted">
                  by {t.actorType.toLowerCase().replace('_', ' ')}
                  {t.note ? ` · “${t.note}”` : ''}
                </span>
                <time dateTime={t.at} className="text-xs text-muted">
                  {relativeTime(t.at)}
                </time>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      {cancelling ? (
        <CancelDialog
          order={{ id: o.id, orderNo: o.orderNo, version: o.version }}
          onClose={() => setCancelling(false)}
          onDone={async () => {
            setCancelling(false);
            await invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

/** Doc 10: every cancellation needs a reason; refunds are a separate step in the Refunds module. */
function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: { id: string; orderNo: string; version: number };
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const client = useApiClient();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const ok = reason.trim().length >= 1;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>Cancel order {order.orderNo}?</DialogTitle>
          <DialogDescription>
            The customer and the vendor are told. A paid order is refunded through the Refunds
            module.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <FormField
          label="Reason"
          hint="Short, e.g. vendor closed, customer request (up to 50 characters)"
        >
          <input
            className={inputClass()}
            maxLength={50}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <FormField label="Note (optional)">
          <textarea
            className={inputClass('min-h-20 py-2')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep order
          </Button>
          <Button
            variant="danger"
            disabled={busy || !ok}
            onClick={async () => {
              setBusy(true);
              setAlert(null);
              try {
                await client.post('/orders/{id}/cancel', {
                  params: { id: order.id },
                  body: {
                    reasonCode: reason.trim(),
                    ...(note.trim() ? { note: note.trim() } : {}),
                  },
                  ifMatch: order.version,
                });
                toast({ title: `Order ${order.orderNo} cancelled` });
                await onDone();
              } catch (err) {
                setAlert(failure(err));
                setBusy(false);
              }
            }}
          >
            Cancel order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
