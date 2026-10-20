'use client';

import {
  BLOCK_REASON,
  customerBlockSchema,
  customerCreateSchema,
  customerUnblockSchema,
  customerUpdateSchema,
  type CustomerDetail,
} from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateCustomers } from './api';

// Customer writes (D28, doc 44): add a customer with a first address (its zone makes them visible there, D25), edit the
// profile copy (name, phone, email; masked values are kept unless retyped), and block or unblock with a reason kept in
// the audit trail. The shared Zod schemas validate here and again on the server.

type Issues = readonly { path: readonly PropertyKey[]; message: string }[];
/** Issue paths like ["address", "pincode"] become "address.pincode"; the first message per field wins. */
export function issuesByField(issues: Issues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.map(String).join('.');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

const problem = (err: unknown) =>
  isApiError(err, 'CONFLICT')
    ? 'A customer with this mobile number already exists.'
    : isApiError(err)
      ? err.message || TRY_AGAIN
      : TRY_AGAIN;

interface Form {
  name: string;
  phone: string;
  email: string;
  zoneId: string;
  label: string;
  address: string;
  area: string;
  pincode: string;
}
const blank = (c?: CustomerDetail): Form => ({
  name: c?.name ?? '',
  phone: '', // masked in responses (D26): kept unless retyped
  email: '',
  zoneId: '',
  label: '',
  address: '',
  area: '',
  pincode: '',
});

/** The body: everything on create; on edit only the typed fields (an empty email is left alone). */
export function customerBody(f: Form, before?: CustomerDetail): Record<string, unknown> {
  if (before)
    return {
      ...(f.name.trim() && f.name.trim() !== before.name ? { name: f.name.trim() } : {}),
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
    };
  return {
    name: f.name.trim(),
    phone: f.phone.trim(),
    ...(f.email.trim() ? { email: f.email.trim() } : {}),
    address: {
      zoneId: f.zoneId,
      address: f.address.trim(),
      ...(f.label.trim() ? { label: f.label.trim() } : {}),
      ...(f.area.trim() ? { area: f.area.trim() } : {}),
      ...(f.pincode.trim() ? { pincode: f.pincode.trim() } : {}),
    },
  };
}

export function CustomerFormDialog({
  open,
  zones,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** where a new customer's first address may go */
  zones: ScopeZone[];
  /** edit this one; absent = add */
  customer?: CustomerDetail;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCustomers();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => blank(customer));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = customer !== undefined;

  useEffect(() => {
    if (open) {
      setForm(blank(customer));
      setErrors({});
      setAlert(null);
    }
  }, [open, customer]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setAlert(null);
    const body = customerBody(form, customer);
    if (editing && Object.keys(body).length === 0) {
      setAlert('Nothing changed.');
      return;
    }
    const call = (() => {
      if (editing) {
        const p = customerUpdateSchema.safeParse(body);
        return p.success
          ? () => client.patch('/customers/{id}', { params: { id: customer.id }, body: p.data })
          : p.error.issues;
      }
      const p = customerCreateSchema.safeParse(body);
      return p.success ? () => client.post('/customers', { body: p.data }) : p.error.issues;
    })();
    if (typeof call !== 'function') {
      setErrors(issuesByField(call));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { id } = await call();
      toast({ title: editing ? 'Changes saved' : `${form.name.trim()} added` });
      await invalidate();
      onClose();
      onSaved?.(id);
    } catch (err) {
      const fields = fieldErrors(err);
      if (Object.keys(fields).length > 0) setErrors(fields);
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof Form,
    label: string,
    error: string | undefined,
    props: { hint?: string; type?: string; wide?: boolean } = {},
  ) => (
    <FormField
      label={label}
      hint={props.hint}
      error={error}
      className={props.wide ? 'flex flex-col gap-1.5 sm:col-span-2' : undefined}
    >
      <Input
        type={props.type ?? 'text'}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <div>
          <DialogTitle>{editing ? `Edit ${customer.name}` : 'Add a customer'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Phone and email are shown masked: type a new value only to change it. Status changes with Block or Unblock.'
              : 'For a customer who orders by phone. They get no app login from this; the first address decides the zone they belong to.'}
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
          {field('name', 'Name', errors['name'])}
          {field('phone', 'Mobile number', errors['phone'], {
            type: 'tel',
            hint: editing ? 'Type a new number only to change it' : '10-digit Indian mobile',
          })}
          {field('email', 'Email', errors['email'], {
            type: 'email',
            hint: editing ? 'Type a new email only to change it' : 'Optional',
            wide: true,
          })}
          {!editing ? (
            <>
              <FormField
                label="Zone of the address"
                error={errors['address.zoneId']}
                className="flex flex-col gap-1.5 sm:col-span-2"
              >
                <select
                  className={inputClass()}
                  value={form.zoneId}
                  onChange={(e) => set('zoneId', e.target.value)}
                >
                  <option value="">Choose a zone</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({z.code})
                    </option>
                  ))}
                </select>
              </FormField>
              {field('address', 'Address', errors['address.address'], { wide: true })}
              {field('label', 'Label', errors['address.label'], { hint: 'Optional, e.g. Home' })}
              {field('area', 'Area', errors['address.area'], { hint: 'Optional' })}
              {field('pincode', 'Pincode', errors['address.pincode'], {
                hint: 'Optional, 6 digits',
              })}
            </>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? 'Save changes' : 'Add customer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BlockDialog({
  customer,
  mode,
  onClose,
}: {
  customer: { id: string; name: string };
  /** null = closed */
  mode: 'block' | 'unblock' | null;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCustomers();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setAlert(null);
  }, [mode]);

  if (!mode) return dialog;
  const blocking = mode === 'block';
  const parsed = (blocking ? customerBlockSchema : customerUnblockSchema).safeParse({ reason });

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      await guarded(
        blocking ? `Block ${customer.name}` : `Unblock ${customer.name}`,
        'PASSWORD',
        () =>
          blocking
            ? client
                .post('/customers/{id}/block', { params: { id: customer.id }, body: parsed.data })
                .then(() => undefined)
            : client
                .post('/customers/{id}/unblock', { params: { id: customer.id }, body: parsed.data })
                .then(() => undefined),
      );
      toast({
        title: blocking ? `${customer.name} is blocked` : `${customer.name} is active again`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div>
            <DialogTitle>
              {blocking ? `Block ${customer.name}?` : `Unblock ${customer.name}?`}
            </DialogTitle>
            <DialogDescription>
              {blocking
                ? 'They can no longer place orders in any zone. Open orders and their history are kept.'
                : 'They can order again. The reason is kept with the block in the audit trail.'}
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <FormField label="Reason" hint={`At least ${BLOCK_REASON.min} characters`}>
            <textarea
              className={inputClass('min-h-20 py-2')}
              maxLength={BLOCK_REASON.max}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={blocking ? 'danger' : 'primary'}
              onClick={() => void run()}
              disabled={busy || !parsed.success}
            >
              {blocking ? 'Block' : 'Unblock'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
