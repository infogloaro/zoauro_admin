'use client';

import { Eye, MapPin } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CustomerDetail } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { EmptyState } from '../../components/shared/states';
import { formatDateTime, formatRupees } from '../../lib/format';
import { cn } from '../../lib/cn';
import { fetchCustomerReveal } from './api';

export type CustomerDetailAction = 'edit' | 'block' | 'unblock';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
};

const STATUS_PILLS: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  BLOCKED: 'bg-red-50 text-red-700',
};

const SOURCE_LABELS: Record<string, string> = {
  APP: 'App',
  ADMIN: 'Admin',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[14px] text-slate-900">{value}</p>
    </div>
  );
}

/**
 * Customer profile (doc 20 Customers: contact, addresses, orders, refunds,
 * status). Contact is masked until the audited reveal (D26) — the reveal
 * button calls GET /customers/{id}/reveal, which needs `customers:reveal`
 * server-side and writes an audit row per call. Orders and refunds render
 * honest empty states until M11/M13 land; the scope-filtered aggregates
 * (D25) are shown above them.
 */
export function CustomerDetailDialog({
  customer,
  externalBusy = false,
  onAction,
  onClose,
}: {
  customer: CustomerDetail;
  externalBusy?: boolean;
  onAction: (action: CustomerDetailAction) => void;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState<{ phone: string; email: string | null } | null>(null);
  const [revealing, setRevealing] = useState(false);

  const blocked = customer.status === 'BLOCKED';

  async function reveal() {
    if (revealing) return;
    setRevealing(true);
    try {
      const contact = await fetchCustomerReveal(customer.id);
      setRevealed(contact);
      toast.success('Contact revealed — the reveal is recorded in the audit log.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not reveal the contact.');
    } finally {
      setRevealing(false);
    }
  }

  const phone = revealed?.phone ?? customer.phone;
  const email = revealed?.email ?? customer.email;

  return (
    <Dialog open onOpenChange={(open) => !open && !externalBusy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {customer.name}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
                STATUS_PILLS[customer.status] ?? 'bg-slate-100 text-slate-600',
              )}
            >
              {STATUS_LABELS[customer.status] ?? customer.status}
            </span>
          </DialogTitle>
          <DialogDescription>
            CUS-{customer.id.slice(0, 4).toUpperCase()} · Registered{' '}
            {formatDateTime(customer.createdAt)}
            {customer.source === 'APP' ? ' · Registered via app' : ''}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-text">Contact</h3>
            {!revealed && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reveal()}
                disabled={revealing}
              >
                <Eye className="size-4" /> {revealing ? 'Revealing…' : 'Reveal'}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone" value={phone} />
            <Field label="Email" value={email ?? '—'} />
            <Field label="Status" value={STATUS_LABELS[customer.status] ?? customer.status} />
            <Field
              label="Registration source"
              value={SOURCE_LABELS[customer.source] ?? customer.source}
            />
          </div>
          {revealed && (
            <p className="text-[12px] text-muted">
              Unmasked for this session — every reveal is written to the audit log.
            </p>
          )}
        </section>

        <section className="mt-5 space-y-3 border-t border-border pt-4">
          <h3 className="text-[15px] font-semibold text-text">Orders and spend</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Orders in your scope" value={String(customer.orderCount)} />
            <Field
              label="Total spent in your scope"
              value={formatRupees(customer.totalSpentPaise)}
            />
          </div>
          <p className="text-[12px] text-muted">
            Counts and spend cover only the zones you can access (scope rule D25).
          </p>
          <EmptyState message="Order history appears here once the Orders module lands." />
          <EmptyState message="Refunds appear here once the Refunds module lands." />
        </section>

        <section className="mt-5 space-y-3 border-t border-border pt-4">
          <h3 className="text-[15px] font-semibold text-text">
            Addresses ({customer.addresses.length})
          </h3>
          {customer.addresses.length === 0 ? (
            <EmptyState message="No saved addresses yet." />
          ) : (
            <ul className="space-y-2">
              {customer.addresses.map((address) => (
                <li
                  key={address.id}
                  className="rounded-[--radius-card] border border-border bg-bg px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted" />
                    <span className="text-[13px] font-medium text-text">
                      {address.label ?? 'Address'}
                    </span>
                    {address.isDefault && <Badge tone="success">Default</Badge>}
                  </div>
                  <p className="mt-1 text-[13px] text-text">{address.address}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {[address.area, address.pincode, address.zone.name].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={externalBusy}>
            Close
          </Button>
          <Button variant="outline" onClick={() => onAction('edit')} disabled={externalBusy}>
            Edit
          </Button>
          <Button
            variant={blocked ? 'default' : 'destructive'}
            onClick={() => onAction(blocked ? 'unblock' : 'block')}
            disabled={externalBusy}
          >
            {blocked ? 'Unblock customer' : 'Block customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
