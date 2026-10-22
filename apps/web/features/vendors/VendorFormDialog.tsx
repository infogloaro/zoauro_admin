'use client';

import {
  OPENING_DAYS,
  RESTAURANT_KINDS,
  homemakerCreateSchema,
  homemakerUpdateSchema,
  paiseToRupees,
  restaurantCreateSchema,
  restaurantUpdateSchema,
  rupeesToPaise,
  type HomemakerDetail,
  type RestaurantDetail,
  type VendorModule,
} from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateVendors } from './api';
import { DAY_LABEL, VENDOR_META } from './labels';

// Add or edit a restaurant or Home Food provider (doc 22 forms, ported from Chittra Priya's vendor form, D117). The
// shared Zod schemas validate here and again on the server. Commission is shown to Super Admins only (never grantable,
// doc 04); the zone is chosen on create and changed later only through "Move zone". Edit sends only what changed.

type Detail = RestaurantDetail | HomemakerDetail;
type DayRow = {
  day: (typeof OPENING_DAYS)[number];
  isOpen: boolean;
  opens: string;
  closes: string;
};

interface Form {
  zoneId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  area: string;
  fssaiNo: string;
  minOrderRupees: string;
  commissionPct: string;
  kind: (typeof RESTAURANT_KINDS)[number];
  ownerName: string;
  gstNo: string;
  tags: string;
  foodCategory: string;
  experienceYears: string;
  isAvailable: boolean;
  dailyCapacity: string;
  hoursOn: boolean;
  hours: DayRow[];
}

const defaultHours = (): DayRow[] =>
  OPENING_DAYS.map((day) => ({ day, isOpen: true, opens: '09:00', closes: '22:00' }));

function fromDetail(v: Detail | undefined): Form {
  const isR = v !== undefined && 'cuisineTags' in v;
  const isH = v !== undefined && 'specialityTags' in v;
  return {
    zoneId: v?.zone?.id ?? '',
    name: v?.name ?? '',
    phone: '', // masked in responses (D26): left empty, kept unless retyped
    email: '',
    address: v?.address ?? '',
    area: v?.area ?? '',
    fssaiNo: v?.fssaiNo ?? '',
    minOrderRupees: v ? String(paiseToRupees(v.minOrderPaise)) : '',
    commissionPct: v ? String(v.commissionPct) : '',
    kind: isR ? v.kind : 'RESTAURANT',
    ownerName: isR ? (v.ownerName ?? '') : '',
    gstNo: isR ? (v.gstNo ?? '') : '',
    tags: isR ? v.cuisineTags.join(', ') : isH ? v.specialityTags.join(', ') : '',
    foodCategory: isH ? (v.foodCategory ?? '') : '',
    experienceYears: isH && v.experienceYears !== null ? String(v.experienceYears) : '',
    isAvailable: isH ? v.isAvailable : true,
    dailyCapacity: isH ? String(v.dailyCapacity) : '1',
    hoursOn: Boolean(v?.openingHours),
    hours: v?.openingHours
      ? v.openingHours.map((d) => ({
          day: d.day,
          isOpen: d.isOpen,
          opens: d.opens ?? '09:00',
          closes: d.closes ?? '22:00',
        }))
      : defaultHours(),
  };
}

const tagsOf = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** The request body: every filled field on create; only changed fields on edit. */
export function vendorBody(
  module: VendorModule,
  f: Form,
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN',
  before?: Form,
  /** commission:edit (D155); a Super Admin's by default */
  withCommission: boolean = role === 'SUPER_ADMIN',
): Record<string, unknown> {
  const all: Record<string, unknown> = {
    name: f.name.trim(),
    address: f.address.trim(),
    ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
    ...(f.email.trim() ? { email: f.email.trim() } : {}),
    area: f.area.trim() || undefined,
    fssaiNo: f.fssaiNo.trim() || undefined,
    minOrderPaise:
      f.minOrderRupees.trim() === '' ? undefined : rupeesToPaise(Number(f.minOrderRupees)),
    ...(withCommission ? { commissionPct: num(f.commissionPct) } : {}),
    openingHours: f.hoursOn
      ? f.hours.map((d) => (d.isOpen ? d : { day: d.day, isOpen: false }))
      : undefined,
    ...(module === 'restaurants'
      ? {
          kind: f.kind,
          ownerName: f.ownerName.trim(),
          cuisineTags: tagsOf(f.tags),
          gstNo: f.gstNo.trim() || undefined,
        }
      : {
          specialityTags: tagsOf(f.tags),
          foodCategory: f.foodCategory.trim() || undefined,
          experienceYears: num(f.experienceYears),
          isAvailable: f.isAvailable,
          dailyCapacity: num(f.dailyCapacity),
        }),
  };
  const clean = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
  if (!before) return { zoneId: f.zoneId, ...clean };
  const prev = vendorBody(module, before, role, undefined, withCommission) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    Object.entries(clean).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(prev[k])),
  );
}

export function VendorFormDialog({
  module,
  role,
  open,
  zones,
  vendor,
  onClose,
  onSaved,
  canCommission,
}: {
  module: VendorModule;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** commission:edit (D155); absent = the Super Admin's */
  canCommission?: boolean;
  open: boolean;
  zones: ScopeZone[];
  /** edit this one; absent = add */
  vendor?: Detail;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const meta = VENDOR_META[module];
  const client = useApiClient();
  const invalidate = useInvalidateVendors(module);
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => fromDetail(vendor));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(fromDetail(vendor));
      setErrors({});
      setAlert(null);
    }
  }, [open, vendor]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editing = vendor !== undefined;

  const save = async () => {
    setAlert(null);
    const body = vendorBody(
      module,
      form,
      role,
      editing ? fromDetail(vendor) : undefined,
      canCommission ?? role === 'SUPER_ADMIN',
    );
    if (editing && Object.keys(body).length === 0) {
      setAlert('Nothing changed.');
      return;
    }
    // each module and mode has its own schema and route, so the request body stays fully typed
    const bad = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) => {
      const out: Record<string, string> = {};
      for (const i of issues) {
        const k = String(i.path[0] ?? '');
        if (!out[k]) out[k] = i.message;
      }
      setErrors(out);
    };
    const call = (() => {
      if (module === 'restaurants') {
        if (editing) {
          const p = restaurantUpdateSchema.safeParse(body);
          return p.success
            ? () => client.patch('/restaurants/{id}', { params: { id: vendor.id }, body: p.data })
            : p.error.issues;
        }
        const p = restaurantCreateSchema.safeParse(body);
        return p.success ? () => client.post('/restaurants', { body: p.data }) : p.error.issues;
      }
      if (editing) {
        const p = homemakerUpdateSchema.safeParse(body);
        return p.success
          ? () => client.patch('/homemakers/{id}', { params: { id: vendor.id }, body: p.data })
          : p.error.issues;
      }
      const p = homemakerCreateSchema.safeParse(body);
      return p.success ? () => client.post('/homemakers', { body: p.data }) : p.error.issues;
    })();
    if (typeof call !== 'function') {
      bad(call);
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
      setAlert(
        isApiError(err, 'ZONE_SERVICE_DISABLED')
          ? `${meta.title} is switched off in this zone (Control Panel), so new ones cannot be added there (D92).`
          : isApiError(err)
            ? err.message || TRY_AGAIN
            : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof Form,
    label: string,
    props: { hint?: string; type?: string; wide?: boolean } = {},
  ) => (
    <FormField
      label={label}
      hint={props.hint}
      error={
        errors[
          key === 'minOrderRupees'
            ? 'minOrderPaise'
            : key === 'tags'
              ? module === 'restaurants'
                ? 'cuisineTags'
                : 'specialityTags'
              : key
        ]
      }
      className={props.wide ? 'flex flex-col gap-1.5 sm:col-span-2' : undefined}
    >
      <Input
        type={props.type ?? 'text'}
        value={String(form[key])}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <div>
          <DialogTitle>{editing ? `Edit ${vendor.name}` : `Add a ${meta.noun}`}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change the details. The zone is changed with Move zone; status and verification have their own actions.'
              : `A new ${meta.noun} starts as Pending and Not verified until its documents are checked.`}
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
          {module === 'restaurants'
            ? field('ownerName', 'Owner name')
            : field('foodCategory', 'Food category', { hint: 'e.g. South Indian meals' })}
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
          {field('tags', module === 'restaurants' ? 'Cuisines' : 'Specialities', {
            hint: 'Comma-separated, up to 5',
          })}
          {module === 'restaurants' ? (
            <FormField label="Type">
              <select
                className={inputClass()}
                value={form.kind}
                onChange={(e) => set('kind', e.target.value as Form['kind'])}
              >
                <option value="RESTAURANT">Restaurant</option>
                <option value="SHOP">Shop</option>
              </select>
            </FormField>
          ) : (
            <>
              {field('experienceYears', 'Years of experience', { type: 'number' })}
              {field('dailyCapacity', 'Orders per day', {
                type: 'number',
                hint: 'How many orders they can take a day',
              })}
              <div className="flex items-center justify-between gap-3 rounded-input border border-line p-3">
                <span id="vendor-available" className="text-sm font-medium">
                  Taking orders now
                </span>
                <Switch
                  checked={form.isAvailable}
                  onChange={(v) => set('isAvailable', v)}
                  labelledBy="vendor-available"
                />
              </div>
            </>
          )}
          {field('fssaiNo', 'FSSAI number', {
            hint: 'Optional here; the licence itself is uploaded as a document',
          })}
          {module === 'restaurants' ? field('gstNo', 'GST number', { hint: 'Optional' }) : null}
          {field('minOrderRupees', 'Minimum order (₹)', { type: 'number', hint: 'Optional' })}
          {(canCommission ?? role === 'SUPER_ADMIN')
            ? field('commissionPct', 'Commission (%)', {
                type: 'number',
                hint: '0 to 50, up to two decimals',
              })
            : null}

          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Opening hours</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.hoursOn}
                onChange={(e) => set('hoursOn', e.target.checked)}
              />
              Set opening hours
            </label>
            {form.hoursOn ? (
              <div className="grid gap-2">
                {form.hours.map((d, i) => (
                  <div key={d.day} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex w-36 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={d.isOpen}
                        onChange={(e) =>
                          set(
                            'hours',
                            form.hours.map((h, j) =>
                              j === i ? { ...h, isOpen: e.target.checked } : h,
                            ),
                          )
                        }
                      />
                      {DAY_LABEL[d.day]}
                    </label>
                    {d.isOpen ? (
                      <>
                        <input
                          type="time"
                          aria-label={`${DAY_LABEL[d.day]} opens`}
                          className={inputClass('w-32')}
                          value={d.opens}
                          onChange={(e) =>
                            set(
                              'hours',
                              form.hours.map((h, j) =>
                                j === i ? { ...h, opens: e.target.value } : h,
                              ),
                            )
                          }
                        />
                        <span aria-hidden>–</span>
                        <input
                          type="time"
                          aria-label={`${DAY_LABEL[d.day]} closes`}
                          className={inputClass('w-32')}
                          value={d.closes}
                          onChange={(e) =>
                            set(
                              'hours',
                              form.hours.map((h, j) =>
                                j === i ? { ...h, closes: e.target.value } : h,
                              ),
                            )
                          }
                        />
                      </>
                    ) : (
                      <span className="text-muted">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            {errors['openingHours'] ? (
              <p className="text-xs font-medium text-danger">{errors['openingHours']}</p>
            ) : null}
          </fieldset>

          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing ? 'Save changes' : `Add ${meta.noun}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
