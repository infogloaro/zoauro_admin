'use client';

import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  createTicketSchema,
  type TicketCategory,
  type TicketPriority,
} from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Combobox, type ComboOption } from '../../components/shared/Combobox';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { useCustomerDetail, useCustomerList } from '../customers/api';
import { useInvalidateTickets } from './api';
import { CATEGORY_LABEL, PRIORITY_LABEL } from './labels';

// Open a ticket on a customer's behalf (D141): pick the customer, optionally one of their recent orders (the ticket then
// belongs to that order's zone), else a zone; category, priority, subject and what the customer said. The API sets the
// SLA deadlines and assigns it (round robin or least busy, D140).

export function NewTicketDialog({
  open,
  zones,
  onClose,
  onCreated,
}: {
  open: boolean;
  zones: ScopeZone[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateTickets();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState<ComboOption | null>(null);
  const [orderId, setOrderId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [category, setCategory] = useState<TicketCategory>('ORDER');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const customers = useCustomerList({ page: 1, sort: 'name', ...(q ? { q } : {}) }, open);
  const detail = useCustomerDetail(customer?.id ?? '', open);
  const orders = customer ? (detail.data?.recentOrders ?? []) : [];

  useEffect(() => {
    if (!open) return;
    setQ('');
    setCustomer(null);
    setOrderId('');
    setZoneId('');
    setCategory('ORDER');
    setPriority('NORMAL');
    setSubject('');
    setDescription('');
    setErrors({});
    setAlert(null);
  }, [open]);

  const save = async () => {
    setAlert(null);
    const parsed = createTicketSchema.safeParse({
      customerId: customer?.id ?? '',
      ...(orderId ? { orderId } : {}),
      ...(!orderId && zoneId ? { zoneId } : {}),
      category,
      priority,
      subject: subject.trim(),
      description: description.trim(),
    });
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      if (out['customerId']) out['customerId'] = 'Choose the customer';
      setErrors(out);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const t = await client.post('/support/tickets', { body: parsed.data });
      toast({
        title: 'Ticket opened',
        description: 'It is assigned and its SLA clock has started.',
      });
      await invalidate();
      onClose();
      onCreated(t.id);
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <div>
          <DialogTitle>Open a ticket</DialogTitle>
          <DialogDescription>
            On a customer’s behalf, for example after a call. Link an order when the problem is
            about one.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void save();
          }}
        >
          <FormField
            label="Customer"
            error={errors['customerId']}
            className="flex flex-col gap-1.5 sm:col-span-2"
          >
            <Combobox
              id=""
              value={customer}
              loading={customers.isFetching}
              placeholder="Type a name or mobile number"
              options={(customers.data?.data ?? []).map((c) => ({
                id: c.id,
                label: c.name,
                hint: c.phone,
              }))}
              onInputChange={setQ}
              onSelect={(o) => {
                setCustomer(o);
                setOrderId('');
              }}
            />
          </FormField>
          <FormField label="Order (optional)" error={errors['orderId']}>
            <select
              className={inputClass()}
              value={orderId}
              disabled={!customer}
              onChange={(e) => setOrderId(e.target.value)}
            >
              <option value="">
                {customer ? 'Not about one order' : 'Choose the customer first'}
              </option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo} · {o.zone.code}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Zone"
            error={errors['zoneId']}
            hint={orderId ? 'The order’s zone' : 'Only needed when the customer has no orders yet'}
          >
            <select
              className={inputClass()}
              value={orderId ? '' : zoneId}
              disabled={Boolean(orderId)}
              onChange={(e) => setZoneId(e.target.value)}
            >
              <option value="">{orderId ? 'From the order' : 'From their latest order'}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Category" error={errors['category']}>
            <select
              className={inputClass()}
              value={category}
              onChange={(e) => setCategory(e.target.value as TicketCategory)}
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority" error={errors['priority']}>
            <select
              className={inputClass()}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Subject"
            error={errors['subject']}
            className="flex flex-col gap-1.5 sm:col-span-2"
          >
            <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField
            label="What the customer said"
            error={errors['description']}
            hint="Saved as the first reply on the ticket"
            className="flex flex-col gap-1.5 sm:col-span-2"
          >
            <textarea
              className={inputClass('min-h-28 py-2')}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Open ticket
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
