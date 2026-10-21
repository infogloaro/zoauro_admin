'use client';

import { Ban, Eye, Pencil, ShieldCheck, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { useApiClient } from '../../lib/api-client';
import { formatPaise } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardSkeleton, DetailError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useCustomerDetail } from './api';
import { BlockDialog, CustomerFormDialog } from './CustomerDialogs';
import { RewardsCard } from './RewardsCard';
import type { CustomerPageProps } from './customer-page-props';
import { CUSTOMER_STATUS_LABEL, CUSTOMER_STATUS_TONE, customersPath, sourceLabel } from './labels';

// One customer (doc 21 detail pattern; B1): profile with masked contacts and an audited reveal (D26), the wallet
// balance, addresses and the 10 latest orders within the member's zones (D25), edit, and block or unblock with a reason.
// The API answers 404 for a customer with no address or order in the member's zones.

export function CustomerDetailPage({ id, role, can }: CustomerPageProps & { id: string }) {
  const detail = useCustomerDetail(id);
  const [editing, setEditing] = useState(false);
  const [blocking, setBlocking] = useState<'block' | 'unblock' | null>(null);
  const listPath = customersPath(role);
  const ordersPath = role === 'SUPER_ADMIN' ? '/super-admin/orders' : '/zone/orders';

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Customer"
          crumbs={[{ label: 'Customers', href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={detail.error}
          what="Customer"
          backHref={listPath}
          backLabel="Back to Customers"
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={8} />;
  const c = detail.data;

  const facts: [string, string][] = [
    ['Phone', c.phone],
    ['Email', c.email ?? '—'],
    ['Source', sourceLabel(c.source)],
    ['Zones', c.zones.length ? c.zones.map((z) => `${z.name} (${z.code})`).join(', ') : '—'],
    ['Orders', String(c.orderCount)],
    ['Spent', formatPaise(c.totalSpentPaise)],
    ['Last order', c.lastOrderAt ? relativeTime(c.lastOrderAt) : 'No orders yet'],
    [
      'Joined',
      new Date(c.createdAt).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
      }),
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={c.name}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Customers', href: listPath },
          { label: c.name },
        ]}
        description={
          role === 'SUPER_ADMIN'
            ? 'Orders and addresses in every zone.'
            : 'Orders and addresses in your zones only.'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can.edit ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Button>
            ) : null}
            {can.status ? (
              c.status === 'BLOCKED' ? (
                <Button variant="secondary" onClick={() => setBlocking('unblock')}>
                  <ShieldCheck aria-hidden className="size-4" /> Unblock
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setBlocking('block')}>
                  <Ban aria-hidden className="size-4" /> Block
                </Button>
              )
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CUSTOMER_STATUS_TONE[c.status]} dot>
          {CUSTOMER_STATUS_LABEL[c.status]}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card aria-labelledby="customer-profile" className="lg:col-span-2">
          <CardHeader
            id="customer-profile"
            title="Profile"
            actions={can.reveal ? <RevealContact id={c.id} /> : undefined}
          />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-sm tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card aria-labelledby="customer-wallet">
          <CardHeader id="customer-wallet" title="Wallet" />
          <CardBody className="flex flex-col gap-2">
            <p className="text-3xl font-semibold tabular-nums">
              {formatPaise(c.walletBalancePaise)}
            </p>
            <p className="text-sm text-muted">Balance the customer can spend on orders.</p>
          </CardBody>
        </Card>
      </div>

      <RewardsCard id={c.id} name={c.name} canEdit={can.loyalty} />

      <Card aria-labelledby="customer-addresses">
        <CardHeader
          id="customer-addresses"
          title="Addresses"
          subtitle={role === 'SUPER_ADMIN' ? undefined : 'In your zones only'}
        />
        <CardBody>
          {c.addresses.length === 0 ? (
            <p className="text-sm text-muted">No address in these zones.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {c.addresses.map((a) => (
                <li key={a.id} className="rounded-input border border-line p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {a.label ?? 'Address'}
                    {a.isDefault ? <Badge tone="brand">Default</Badge> : null}
                    {a.zone ? <Badge tone="neutral">{a.zone.code}</Badge> : null}
                  </p>
                  <p className="mt-1">{a.address}</p>
                  <p className="text-xs text-muted">
                    {[a.area, a.pincode].filter(Boolean).join(' · ') || '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card aria-labelledby="customer-orders">
        <CardHeader id="customer-orders" title="Recent orders" subtitle="The 10 latest" />
        <CardBody>
          {c.recentOrders.length === 0 ? (
            <EmptyState icon={<ShoppingBag aria-hidden className="size-5" />} title="No orders yet">
              Orders in these zones appear here.
            </EmptyState>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Recent orders of {c.name}</caption>
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Order</th>
                  <th className="py-2 font-medium">Zone</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Placed</th>
                </tr>
              </thead>
              <tbody>
                {c.recentOrders.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="py-2">
                      <a
                        href={`${ordersPath}/${o.id}`}
                        className="font-medium text-primary-strong underline-offset-2 hover:underline"
                      >
                        {o.orderNo}
                      </a>
                    </td>
                    <td className="py-2">
                      <Badge tone="neutral">{o.zone.code}</Badge>
                    </td>
                    <td className="py-2">{o.status.replaceAll('_', ' ').toLowerCase()}</td>
                    <td className="py-2 text-right tabular-nums">{formatPaise(o.totalPaise)}</td>
                    <td className="py-2 text-right text-xs text-muted">
                      {relativeTime(o.placedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <CustomerFormDialog
        open={editing}
        zones={[]}
        customer={c}
        onClose={() => setEditing(false)}
      />
      <BlockDialog customer={c} mode={blocking} onClose={() => setBlocking(null)} />
    </div>
  );
}

/** D26: the unmasked phone and email, on request only; every reveal is audited and rate-limited by the API. */
function RevealContact({ id }: { id: string }) {
  const client = useApiClient();
  const [shown, setShown] = useState<{ phone: string; email: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (shown)
    return (
      <p className="text-right text-sm" aria-live="polite">
        <span className="block font-medium tabular-nums">{shown.phone}</span>
        <span className="block text-muted">{shown.email ?? 'No email'}</span>
      </p>
    );
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setShown(await client.get('/customers/{id}/reveal', { params: { id } }));
          } catch (err) {
            setError(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Eye aria-hidden className="size-4" /> Reveal contact
      </Button>
      <span className="text-xs text-muted">{error ?? 'Recorded in the audit log'}</span>
    </div>
  );
}
