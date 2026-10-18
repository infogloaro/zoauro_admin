'use client';

import { partnerCreateSchema, partnerUpdateSchema, type PartnerDetail } from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidatePartners } from './api';

// Add or edit a delivery partner (approved list item 3; doc 22 partner form). A Zonal Admin picks one of their zones
// (one zone per partner). Edit sends only what changed plus the version (D130); a concurrent edit is 409 STALE_VERSION.
// Phone and email are shown masked (D26): left empty on edit and changed only when retyped.

interface Form {
  zoneId: string;
  name: string;
  phone: string;
  email: string;
  vehicleType: string;
  vehicleNo: string;
  area: string;
}

const fromPartner = (p?: PartnerDetail): Form => ({
  zoneId: p?.zone?.id ?? '',
  name: p?.name ?? '',
  phone: '',
  email: '',
  vehicleType: p?.vehicleType ?? '',
  vehicleNo: p?.vehicleNo ?? '',
  area: p?.area ?? '',
});

/** Create: every filled field. Edit: only changed fields (cleared optional fields become null) plus the version. */
export function partnerBody(f: Form, before?: Form): Record<string, unknown> {
  const t = (s: string) => s.trim();
  if (!before)
    return Object.fromEntries(
      Object.entries({
        zoneId: f.zoneId,
        name: t(f.name),
        phone: t(f.phone),
        email: t(f.email) || undefined,
        vehicleType: t(f.vehicleType) || undefined,
        vehicleNo: t(f.vehicleNo) || undefined,
        area: t(f.area) || undefined,
      }).filter(([, v]) => v !== undefined),
    );
  const out: Record<string, unknown> = {};
  if (t(f.name) !== t(before.name)) out['name'] = t(f.name);
  if (t(f.phone)) out['phone'] = t(f.phone);
  if (t(f.email)) out['email'] = t(f.email);
  for (const k of ['vehicleType', 'vehicleNo', 'area'] as const)
    if (t(f[k]) !== t(before[k])) out[k] = t(f[k]) || null;
  return out;
}

export function PartnerFormDialog({
  open,
  zones,
  partner,
  onClose,
  onSaved,
}: {
  open: boolean;
  zones: ScopeZone[];
  /** edit this one; absent = add */
  partner?: PartnerDetail;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidatePartners();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => fromPartner(partner));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(fromPartner(partner));
      setErrors({});
      setAlert(null);
    }
  }, [open, partner]);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const editing = partner !== undefined;

  const save = async () => {
    setAlert(null);
    const issuesToErrors = (
      issues: readonly { path: readonly PropertyKey[]; message: string }[],
    ) => {
      const out: Record<string, string> = {};
      for (const i of issues) {
        const k = String(i.path[0] ?? '');
        if (!out[k]) out[k] = i.message;
      }
      setErrors(out);
    };
    let call: () => Promise<{ id: string }>;
    if (editing) {
      const changes = partnerBody(form, fromPartner(partner));
      if (Object.keys(changes).length === 0) {
        setAlert('Nothing changed.');
        return;
      }
      const p = partnerUpdateSchema.safeParse({ ...changes, version: partner.version });
      if (!p.success) return issuesToErrors(p.error.issues);
      call = () =>
        client.patch('/delivery-partners/{id}', { params: { id: partner.id }, body: p.data });
    } else {
      const p = partnerCreateSchema.safeParse(partnerBody(form));
      if (!p.success) return issuesToErrors(p.error.issues);
      call = () => client.post('/delivery-partners', { body: p.data });
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
      setAlert(
        isApiError(err, 'STALE_VERSION')
          ? 'Someone changed this partner a moment ago. Close and open it again.'
          : isApiError(err)
            ? err.message || TRY_AGAIN
            : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof Form, label: string, hint?: string, type = 'text') => (
    <FormField label={label} hint={hint} error={errors[key]}>
      <Input type={type} value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <div>
          <DialogTitle>{editing ? `Edit ${partner.name}` : 'Add a delivery partner'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'The zone changes with Move zone; status and verification have their own actions.'
              : 'A new partner waits for verification of their documents before they can be activated.'}
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
          {!editing ? (
            <FormField
              label="Zone"
              error={errors['zoneId']}
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
          ) : null}
          {field('name', 'Name')}
          {field(
            'phone',
            'Mobile number',
            editing
              ? 'Shown masked; type a new number only to change it'
              : '10-digit Indian mobile',
            'tel',
          )}
          {field(
            'email',
            'Email',
            editing ? 'Type a new email only to change it' : 'Optional',
            'email',
          )}
          {field('area', 'Area', 'Optional, e.g. Anna Nagar West')}
          {field('vehicleType', 'Vehicle type', 'Optional, e.g. Bike, Scooter, Cycle')}
          {field('vehicleNo', 'Vehicle number', 'Optional, like TN09AB1234')}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? 'Save changes' : 'Add partner'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
