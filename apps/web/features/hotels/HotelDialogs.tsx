'use client';

import {
  BOOKING_PAYMENT_STATUSES,
  bookingCreateSchema,
  diningCreateSchema,
  hotelCreateSchema,
  hotelUpdateSchema,
  rupeesToPaise,
  VERIFICATION_NOTE,
  type BookingPaymentStatus,
  type HotelDetail,
  type VendorStatusTarget,
  type VerificationDecision,
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
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { useVendorList } from '../vendors/api';
import { claimedMessage } from '../claims/api';
import { useHotelList, useInvalidateHotels } from './api';
import { PAYMENT_LABEL, todayInIndia, type Move } from './labels';

// Hotel Room Booking dialogs (doc 22 forms; layout from Chittra Priya's hotel dialogs, D117, rebuilt on the live API
// a03cf45): add/edit a hotel, its decisions (verify/reject, activate/deactivate/suspend, delete), a new room booking, a
// new table booking, and a booking's status move at the version seen (409 STALE_VERSION reloads). The shared Zod
// schemas validate here and again on the server. Nothing is reported as done unless the API says so.

type Issues = readonly { path: readonly PropertyKey[]; message: string }[];
const byField = (issues: Issues) => {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    if (!out[k]) out[k] = i.message;
  }
  return out;
};
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** The API's words for the errors these dialogs can meet (D92, D127, doc 10). */
export function hotelProblem(err: unknown): string {
  const claimed = claimedMessage(err);
  if (claimed) return claimed;
  if (isApiError(err, 'ZONE_SERVICE_DISABLED'))
    return 'Hotel Booking is switched off in this zone (Control Panel), so nothing new can be added there (D92).';
  if (isApiError(err, 'NO_ROOMS_AVAILABLE'))
    return 'No room is free for every night of this stay. Choose other dates.';
  if (isApiError(err, 'STALE_VERSION'))
    return 'This booking changed a moment ago. It has been reloaded: check it and try again.';
  if (isApiError(err, 'INVALID_STATE_TRANSITION'))
    return 'That change is no longer possible from the current status. The booking has been reloaded.';
  return isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN;
}

// ---- add / edit a hotel ---------------------------------------------------------------------------------------------

interface HotelForm {
  zoneId: string;
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  area: string;
  totalRooms: string;
  commissionPct: string;
  gstNo: string;
}

function hotelForm(h: HotelDetail | undefined): HotelForm {
  return {
    zoneId: h?.zone.id ?? '',
    name: h?.name ?? '',
    ownerName: h?.ownerName ?? '',
    phone: '', // masked in responses (D26): left empty, kept unless retyped
    email: '',
    address: h?.address ?? '',
    area: h?.area ?? '',
    totalRooms: h ? String(h.totalRooms) : '',
    commissionPct: h ? String(h.commissionPct) : '',
    gstNo: h?.gstNo ?? '',
  };
}

/** The request body: every filled field on create; only changed fields on edit. Commission only when allowed (D155). */
export function hotelBody(
  f: HotelForm,
  canCommission: boolean,
  before?: HotelForm,
): Record<string, unknown> {
  const all: Record<string, unknown> = {
    name: f.name.trim(),
    ownerName: f.ownerName.trim(),
    address: f.address.trim(),
    ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
    ...(f.email.trim() ? { email: f.email.trim() } : {}),
    area: f.area.trim() || undefined,
    totalRooms: num(f.totalRooms),
    gstNo: f.gstNo.trim() || undefined,
    ...(canCommission ? { commissionPct: num(f.commissionPct) } : {}),
  };
  const clean = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
  if (!before) return { zoneId: f.zoneId, ...clean };
  const prev = hotelBody(before, canCommission);
  return Object.fromEntries(
    Object.entries(clean).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(prev[k])),
  );
}

export function HotelFormDialog({
  open,
  zones,
  hotel,
  canCommission,
  onClose,
  onSaved,
}: {
  open: boolean;
  zones: ScopeZone[];
  /** edit this one; absent = add */
  hotel?: HotelDetail;
  canCommission: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateHotels();
  const { toast } = useToast();
  const [form, setForm] = useState<HotelForm>(() => hotelForm(hotel));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = hotel !== undefined;

  useEffect(() => {
    if (open) {
      setForm(hotelForm(hotel));
      setErrors({});
      setAlert(null);
    }
  }, [open, hotel]);

  const set = <K extends keyof HotelForm>(k: K, v: HotelForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setAlert(null);
    const body = hotelBody(form, canCommission, editing ? hotelForm(hotel) : undefined);
    if (editing && Object.keys(body).length === 0) {
      setAlert('Nothing changed.');
      return;
    }
    const call = (() => {
      if (editing) {
        const p = hotelUpdateSchema.safeParse(body);
        return p.success
          ? () => client.patch('/hotels/{id}', { params: { id: hotel.id }, body: p.data })
          : p.error.issues;
      }
      const p = hotelCreateSchema.safeParse(body);
      return p.success ? () => client.post('/hotels', { body: p.data }) : p.error.issues;
    })();
    if (typeof call !== 'function') {
      setErrors(byField(call));
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
      setAlert(hotelProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof HotelForm,
    label: string,
    props: { hint?: string; type?: string; wide?: boolean } = {},
  ) => (
    <FormField
      label={label}
      hint={props.hint}
      error={errors[key]}
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <div>
          <DialogTitle>{editing ? `Edit ${hotel.name}` : 'Add a hotel'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change the details. Status and verification have their own actions; the zone is fixed.'
              : 'A new hotel starts as Pending and Not verified. It takes bookings once verified and active.'}
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
          {field('name', 'Hotel name')}
          {field('ownerName', 'Owner name')}
          {field('phone', 'Mobile number', {
            type: 'tel',
            hint: editing
              ? 'Shown masked; type a new number only to change it'
              : '10-digit Indian mobile',
          })}
          {field('email', 'Email', {
            type: 'email',
            hint: editing ? 'Type a new email only to change it' : 'Optional',
          })}
          {field('address', 'Address', { wide: true })}
          {field('area', 'Area', { hint: 'Optional, e.g. Anna Nagar West' })}
          {field('totalRooms', 'Rooms', { type: 'number', hint: 'Rooms that can be booked' })}
          {field('gstNo', 'GST number', { hint: 'Optional' })}
          {canCommission
            ? field('commissionPct', 'Commission (%)', {
                type: 'number',
                hint: 'Platform commission on bookings',
              })
            : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? 'Save changes' : 'Add hotel'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- hotel decisions --------------------------------------------------------------------------------------------------

export type HotelAction =
  | { kind: 'status'; to: VendorStatusTarget }
  | { kind: 'verify'; decision: VerificationDecision }
  | { kind: 'delete' };

const STATUS_COPY: Record<VendorStatusTarget, { verb: string; done: string; text: string }> = {
  ACTIVE: { verb: 'Activate', done: 'is active', text: 'Guests can book rooms and tables again.' },
  INACTIVE: {
    verb: 'Deactivate',
    done: 'is inactive',
    text: 'No new bookings. Existing bookings and their history are kept.',
  },
  SUSPENDED: {
    verb: 'Suspend',
    done: 'is suspended',
    text: 'For a policy or quality problem: no new bookings until reactivated. History is kept.',
  },
};

export function HotelActionDialog({
  hotel,
  action,
  onClose,
  onDone,
}: {
  hotel: { id: string; name: string };
  action: HotelAction | null;
  onClose: () => void;
  onDone?: (action: HotelAction) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateHotels();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setText('');
    setAlert(null);
  }, [action]);

  if (!action) return dialog;

  const copy = (() => {
    switch (action.kind) {
      case 'status': {
        const c = STATUS_COPY[action.to];
        return {
          title: `${c.verb} ${hotel.name}?`,
          text: c.text,
          button: c.verb,
          danger: action.to !== 'ACTIVE',
          noteLabel: 'Reason',
          noteRequired: action.to !== 'ACTIVE',
          done: `${hotel.name} ${c.done}`,
        };
      }
      case 'verify':
        return action.decision === 'VERIFIED'
          ? {
              title: `Verify ${hotel.name}?`,
              text: 'Confirms their details are checked. The hotel can then be activated.',
              button: 'Verify',
              danger: false,
              noteLabel: 'Note',
              noteRequired: false,
              done: `${hotel.name} is verified`,
            }
          : {
              title: `Reject ${hotel.name}?`,
              text: 'Say what must be fixed before they can be verified. The note is required.',
              button: 'Reject',
              danger: true,
              noteLabel: 'What is wrong',
              noteRequired: true,
              done: `${hotel.name} was rejected`,
            };
      case 'delete':
        return {
          title: `Delete ${hotel.name}?`,
          text: 'The hotel disappears from the lists. Its bookings and history are kept (soft delete).',
          button: 'Delete',
          danger: true,
          noteLabel: 'Note',
          noteRequired: false,
          done: `${hotel.name} was deleted`,
        };
    }
  })();

  const note = text.trim();
  const ready = !copy.noteRequired || note.length >= VERIFICATION_NOTE.min;

  const run = async () => {
    setAlert(null);
    setBusy(true);
    try {
      await guarded(copy.title.replace(/\?$/, ''), 'PASSWORD', async () => {
        const params = { id: hotel.id };
        if (action.kind === 'status')
          await client.post('/hotels/{id}/status', {
            params,
            body: { status: action.to, ...(note ? { reason: note } : {}) },
          });
        else if (action.kind === 'verify')
          await client.post('/hotels/{id}/verification', {
            params,
            body: { decision: action.decision, ...(note ? { note } : {}) },
          });
        else await client.delete('/hotels/{id}', { params });
      });
      toast({ title: copy.done });
      await invalidate();
      onClose();
      onDone?.(action);
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(hotelProblem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.text}</DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          {action.kind !== 'delete' ? (
            <FormField label={copy.noteRequired ? copy.noteLabel : `${copy.noteLabel} (optional)`}>
              <textarea
                className={inputClass('min-h-20 py-2')}
                maxLength={300}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </FormField>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={copy.danger ? 'danger' : 'primary'}
              onClick={() => void run()}
              disabled={busy || !ready}
            >
              {copy.button}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

// ---- venue pickers ----------------------------------------------------------------------------------------------------

/** Active hotels matching the typed text (scoped by the API to the member's zones). */
function HotelPicker({
  value,
  onSelect,
  error,
}: {
  value: ComboOption | null;
  onSelect: (o: ComboOption | null) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const list = useHotelList({ page: 1, sort: 'name', status: 'ACTIVE', ...(q ? { q } : {}) });
  return (
    <FormField label="Hotel" error={error} className="flex flex-col gap-1.5 sm:col-span-2">
      <Combobox
        id=""
        value={value}
        loading={list.isFetching}
        placeholder="Type a hotel name"
        options={(list.data?.data ?? []).map((h) => ({
          id: h.id,
          label: h.name,
          hint: `${h.zone.code}${h.area ? ` · ${h.area}` : ''}`,
        }))}
        onInputChange={setQ}
        onSelect={onSelect}
      />
    </FormField>
  );
}

/** Active restaurants for a table booking at a restaurant (D127: a hotel kitchen is onboarded as a restaurant). */
function RestaurantPicker({
  value,
  onSelect,
  error,
}: {
  value: ComboOption | null;
  onSelect: (o: ComboOption | null) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const list = useVendorList('restaurants', {
    page: 1,
    sort: 'name',
    status: 'ACTIVE',
    ...(q ? { q } : {}),
  });
  return (
    <FormField
      label="Restaurant"
      error={error ?? (list.isError ? 'Restaurants could not be loaded.' : undefined)}
      className="flex flex-col gap-1.5 sm:col-span-2"
    >
      <Combobox
        id=""
        value={value}
        loading={list.isFetching}
        placeholder="Type a restaurant name"
        options={(list.data?.data ?? []).map((r) => ({
          id: r.id,
          label: r.name,
          hint: r.zone ? r.zone.code : undefined,
        }))}
        onInputChange={setQ}
        onSelect={onSelect}
      />
    </FormField>
  );
}

function PaymentSelect({
  value,
  onChange,
}: {
  value: BookingPaymentStatus;
  onChange: (v: BookingPaymentStatus) => void;
}) {
  return (
    <FormField label="Payment" hint="For information only: nothing is charged or refunded here">
      <select
        className={inputClass()}
        value={value}
        onChange={(e) => onChange(e.target.value as BookingPaymentStatus)}
      >
        {BOOKING_PAYMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PAYMENT_LABEL[s]}
          </option>
        ))}
      </select>
    </FormField>
  );
}

// ---- new room booking -------------------------------------------------------------------------------------------------

export function BookingFormDialog({
  open,
  hotel,
  onClose,
}: {
  open: boolean;
  /** book at this hotel; absent = choose one */
  hotel?: { id: string; name: string };
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateHotels();
  const { toast } = useToast();
  const blank = () => {
    const today = todayInIndia();
    return {
      customerName: '',
      customerPhone: '',
      roomType: '',
      checkIn: today,
      checkOut: '',
      guests: '1',
      amountRupees: '',
      paymentStatus: 'PENDING' as BookingPaymentStatus,
      note: '',
    };
  };
  const [form, setForm] = useState(blank);
  const [venue, setVenue] = useState<ComboOption | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(blank());
      setVenue(null);
      setErrors({});
      setAlert(null);
    }
  }, [open]);

  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const hotelId = hotel?.id ?? venue?.id ?? '';

  const save = async () => {
    setAlert(null);
    const parsed = bookingCreateSchema.safeParse({
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      roomType: form.roomType.trim(),
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      guests: Number(form.guests),
      amount: form.amountRupees.trim() === '' ? 0 : rupeesToPaise(Number(form.amountRupees)),
      paymentStatus: form.paymentStatus,
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });
    const out = parsed.success ? {} : byField(parsed.error.issues);
    if (!hotelId) out['hotelId'] = 'Choose a hotel';
    if (!parsed.success || !hotelId) {
      setErrors(out);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await client.post('/hotels/{id}/bookings', { params: { id: hotelId }, body: parsed.data });
      toast({ title: `Room booked for ${parsed.data.customerName}` });
      await invalidate();
      onClose();
    } catch (err) {
      const fields = fieldErrors(err);
      if (Object.keys(fields).length > 0) setErrors(fields);
      setAlert(hotelProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: 'customerName' | 'customerPhone' | 'roomType' | 'checkIn' | 'checkOut' | 'guests',
    label: string,
    props: { hint?: string; type?: string } = {},
  ) => (
    <FormField label={label} hint={props.hint} error={errors[key]}>
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
          <DialogTitle>
            {hotel ? `New room booking at ${hotel.name}` : 'New room booking'}
          </DialogTitle>
          <DialogDescription>
            The stay must fit the hotel&apos;s free rooms on every night. Check-out day is not a
            night.
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
          {!hotel ? (
            <HotelPicker value={venue} onSelect={setVenue} error={errors['hotelId']} />
          ) : null}
          {field('customerName', 'Guest name')}
          {field('customerPhone', 'Guest mobile', { type: 'tel', hint: '10-digit Indian mobile' })}
          {field('roomType', 'Room type', { hint: 'e.g. Deluxe double' })}
          {field('guests', 'Guests', { type: 'number' })}
          {field('checkIn', 'Check-in', { type: 'date' })}
          {field('checkOut', 'Check-out', { type: 'date' })}
          <FormField label="Amount (₹)" error={errors['amount']} hint="Total for the stay">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.amountRupees}
              onChange={(e) => set('amountRupees', e.target.value)}
            />
          </FormField>
          <PaymentSelect value={form.paymentStatus} onChange={(v) => set('paymentStatus', v)} />
          <FormField label="Note (optional)" className="flex flex-col gap-1.5 sm:col-span-2">
            <textarea
              className={inputClass('min-h-16 py-2')}
              maxLength={300}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Book room
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- new table booking ------------------------------------------------------------------------------------------------

export function DiningFormDialog({
  open,
  hotel,
  onClose,
}: {
  open: boolean;
  /** at this hotel; absent = choose a hotel or a restaurant */
  hotel?: { id: string; name: string };
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateHotels();
  const { toast } = useToast();
  const blank = () => ({
    customerName: '',
    customerPhone: '',
    reservedDate: todayInIndia(),
    reservedTime: '19:30',
    guests: '2',
    tableArea: '',
    amountRupees: '',
    paymentStatus: 'PENDING' as BookingPaymentStatus,
    note: '',
  });
  const [form, setForm] = useState(blank);
  const [kind, setKind] = useState<'hotel' | 'restaurant'>('hotel');
  const [venue, setVenue] = useState<ComboOption | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(blank());
      setKind('hotel');
      setVenue(null);
      setErrors({});
      setAlert(null);
    }
  }, [open]);

  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const venueId = hotel?.id ?? venue?.id;

  const save = async () => {
    setAlert(null);
    const atHotel = Boolean(hotel) || kind === 'hotel';
    const parsed = diningCreateSchema.safeParse({
      ...(venueId ? (atHotel ? { hotelId: venueId } : { restaurantId: venueId }) : {}),
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      reservedDate: form.reservedDate,
      reservedTime: form.reservedTime,
      guests: Number(form.guests),
      ...(form.tableArea.trim() ? { tableArea: form.tableArea.trim() } : {}),
      ...(form.amountRupees.trim() !== ''
        ? { amount: rupeesToPaise(Number(form.amountRupees)) }
        : {}),
      paymentStatus: form.paymentStatus,
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });
    if (!parsed.success) {
      const out = byField(parsed.error.issues);
      if (!venueId) out['venue'] = atHotel ? 'Choose a hotel' : 'Choose a restaurant';
      setErrors(out);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await client.post('/hotels/dining', { body: parsed.data });
      toast({ title: `Table booked for ${parsed.data.customerName}` });
      await invalidate();
      onClose();
    } catch (err) {
      const fields = fieldErrors(err);
      if (Object.keys(fields).length > 0) setErrors(fields);
      setAlert(hotelProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key:
      'customerName' | 'customerPhone' | 'reservedDate' | 'reservedTime' | 'guests' | 'tableArea',
    label: string,
    props: { hint?: string; type?: string } = {},
  ) => (
    <FormField label={label} hint={props.hint} error={errors[key]}>
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
          <DialogTitle>
            {hotel ? `New table booking at ${hotel.name}` : 'New table booking'}
          </DialogTitle>
          <DialogDescription>
            A table at a hotel or a restaurant for a date and time.
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
          {!hotel ? (
            <>
              <FormField label="Where" className="flex flex-col gap-1.5 sm:col-span-2">
                <select
                  className={inputClass()}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value === 'restaurant' ? 'restaurant' : 'hotel');
                    setVenue(null);
                  }}
                >
                  <option value="hotel">At a hotel</option>
                  <option value="restaurant">At a restaurant</option>
                </select>
              </FormField>
              {kind === 'hotel' ? (
                <HotelPicker
                  value={venue}
                  onSelect={setVenue}
                  error={errors['venue'] ?? errors['hotelId']}
                />
              ) : (
                <RestaurantPicker
                  value={venue}
                  onSelect={setVenue}
                  error={errors['venue'] ?? errors['restaurantId']}
                />
              )}
            </>
          ) : null}
          {field('customerName', 'Guest name')}
          {field('customerPhone', 'Guest mobile', { type: 'tel', hint: '10-digit Indian mobile' })}
          {field('reservedDate', 'Date', { type: 'date' })}
          {field('reservedTime', 'Time', { type: 'time', hint: '24-hour, e.g. 19:30' })}
          {field('guests', 'Guests', { type: 'number' })}
          {field('tableArea', 'Table area', { hint: 'Optional, e.g. Rooftop' })}
          <FormField label="Amount (₹, optional)" error={errors['amount']}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.amountRupees}
              onChange={(e) => set('amountRupees', e.target.value)}
            />
          </FormField>
          <PaymentSelect value={form.paymentStatus} onChange={(v) => set('paymentStatus', v)} />
          <FormField label="Note (optional)" className="flex flex-col gap-1.5 sm:col-span-2">
            <textarea
              className={inputClass('min-h-16 py-2')}
              maxLength={300}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Book table
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- status move of a room or table booking ---------------------------------------------------------------------------

export interface PendingMove<T extends string> {
  kind: 'booking' | 'dining';
  id: string;
  version: number;
  customer: string;
  move: Move<T>;
}

export function MoveDialog<T extends string>({
  pending,
  onClose,
}: {
  pending: PendingMove<T> | null;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateHotels();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setText('');
    setAlert(null);
  }, [pending]);

  if (!pending) return null;
  const { move } = pending;

  const run = async () => {
    setAlert(null);
    setBusy(true);
    const note = text.trim();
    try {
      if (pending.kind === 'booking')
        await client.post('/hotels/bookings/{bookingId}/status', {
          params: { bookingId: pending.id },
          body: {
            status: move.to as 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED',
            version: pending.version,
            ...(note ? { note } : {}),
          },
        });
      else
        await client.post('/hotels/dining/{diningId}/status', {
          params: { diningId: pending.id },
          body: {
            status: move.to as 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
            version: pending.version,
            ...(note ? { note } : {}),
          },
        });
      toast({ title: `${pending.customer}: ${move.done}` });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(hotelProblem(err));
      // a stale version or an impossible move: show the current state behind the dialog
      if (isApiError(err, 'STALE_VERSION') || isApiError(err, 'INVALID_STATE_TRANSITION'))
        await invalidate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>
            {move.verb} for {pending.customer}?
          </DialogTitle>
          <DialogDescription>{move.text}</DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <FormField label={move.danger ? 'Reason (optional)' : 'Note (optional)'}>
          <textarea
            className={inputClass('min-h-20 py-2')}
            maxLength={300}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            variant={move.danger ? 'danger' : 'primary'}
            onClick={() => void run()}
            disabled={busy}
          >
            {move.verb}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
