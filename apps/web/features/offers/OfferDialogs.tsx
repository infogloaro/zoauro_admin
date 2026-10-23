'use client';

import {
  OFFER_PAYMENT_METHODS,
  OFFER_TYPES,
  OFFER_VENDOR_TYPES,
  offerCreateSchema,
  offerDecisionSchema,
  offerReasonSchema,
  offerUpdateSchema,
  rupeesToPaise,
  type Offer,
  type OfferPaymentMethod,
  type OfferScope,
  type OfferType,
  type OfferVendorType,
} from '@zoauro/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { useZoneOptions } from '../platform-settings/api';
import { useInvalidateOffers, useOfferVendors } from './api';
import {
  PAYMENT_LABEL,
  SCOPE_LABEL,
  TYPE_LABEL,
  fundingText,
  isoToLocal,
  localToIso,
  valueText,
  whereText,
  type OfferAction,
} from './labels';

// Offer changes (D182, D199, D204). Create a draft (every-zone offers and shared funding: Super Admin; a Zonal Admin
// picks from their offers:add zones or a vendor there); edit a draft or a rejected offer; once approved, a Super Admin
// may only raise the budget or the total uses, or bring the end forward. Approve and reject ask for the password.
// Nothing is reported as done unless the API says so; its field problems are shown under the fields.

const problem = (err: unknown): string => {
  if (isApiError(err, 'STALE_VERSION'))
    return 'This offer changed a moment ago. It has been reloaded: check it and try again.';
  if (isApiError(err, 'FORBIDDEN'))
    return err.message || 'You cannot do this one (for example, decide your own offer).';
  return isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN;
};
const fieldErrors = (err: unknown): Record<string, string> => {
  if (!isApiError(err)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details ?? []) if (d.field) out[d.field] = d.issue;
  return out;
};

function Shell({
  title,
  text,
  alert,
  busy,
  onClose,
  children,
  footer,
}: {
  title: string;
  text: string;
  alert: string | null;
  busy: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {children ? <div className="flex flex-col gap-4">{children}</div> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_HELP: Record<string, string> = {
  title: 'Use 3 to 80 characters.',
  code: 'Use 4 to 20 letters or digits, or leave it empty for an automatic offer.',
  value: 'Check the discount (percent 1–100, or at least ₹1).',
  maxDiscountPaise: 'Only a percent offer has a maximum, at least ₹1.',
  zoneIds: 'Pick at least one zone.',
  vendor: 'Pick the vendor.',
  vendorSharePct: 'A shared offer needs the vendor’s share, 1 to 99%.',
  perCustomerLimit: 'Use 1 to 100.',
  usageLimit: 'A whole number, or empty for no limit.',
  budgetPaise: 'At least ₹1, or empty for no budget.',
  validFrom: 'Pick when it starts.',
  validTo: 'End after the start and in the future.',
};

const rupees = (paise: number | null) => (paise === null ? '' : String(paise / 100));
const paiseOrNull = (v: string) => (v.trim() === '' ? null : rupeesToPaise(Number(v)));
const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

// ---- create or edit -------------------------------------------------------------------------------------------------

export function OfferFormDialog({
  role,
  addZones,
  offer,
  onClose,
  onCreated,
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** a Zonal Admin's offers:add zones (empty for a Super Admin: every zone) */
  addZones: ScopeZone[];
  /** absent: a new offer */
  offer?: Offer;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateOffers();
  const { toast } = useToast();
  const superAdmin = role === 'SUPER_ADMIN';
  const locked = offer ? ['SCHEDULED', 'ACTIVE', 'PAUSED'].includes(offer.status) : false;
  const zoneOptions = useZoneOptions(superAdmin && !offer);
  const zones: { id: string; name: string; code: string }[] = superAdmin
    ? (zoneOptions.data?.data ?? [])
    : addZones;

  const [scope, setScope] = useState<OfferScope>(offer?.scope ?? 'ZONE');
  const [zoneIds, setZoneIds] = useState<string[]>(
    offer?.zones.map((z) => z.id) ?? (addZones.length === 1 && addZones[0] ? [addZones[0].id] : []),
  );
  const [vendorType, setVendorType] = useState<OfferVendorType>('RESTAURANT');
  const [vendorQ, setVendorQ] = useState('');
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState(offer?.title ?? '');
  const [description, setDescription] = useState(offer?.description ?? '');
  const [code, setCode] = useState(offer?.code ?? '');
  const [type, setType] = useState<OfferType>(offer?.type ?? 'PERCENT');
  const [value, setValue] = useState(
    offer ? (offer.type === 'FLAT' ? rupees(offer.value) : String(offer.value)) : '',
  );
  const [maxDiscount, setMaxDiscount] = useState(rupees(offer?.maxDiscountPaise ?? null));
  const [minOrder, setMinOrder] = useState(offer ? rupees(offer.minOrderPaise) : '');
  const [newOnly, setNewOnly] = useState(offer?.newCustomersOnly ?? false);
  const [methods, setMethods] = useState<OfferPaymentMethod[]>(offer?.paymentMethods ?? []);
  const [perCustomer, setPerCustomer] = useState(String(offer?.perCustomerLimit ?? 1));
  const [usageLimit, setUsageLimit] = useState(offer?.usageLimit ? String(offer.usageLimit) : '');
  const [budget, setBudget] = useState(rupees(offer?.budgetPaise ?? null));
  const [shared, setShared] = useState(offer?.fundedBy === 'SHARED');
  const [share, setShare] = useState(offer?.vendorSharePct ? String(offer.vendorSharePct) : '');
  const [from, setFrom] = useState(offer ? isoToLocal(offer.validFrom) : '');
  const [to, setTo] = useState(offer ? isoToLocal(offer.validTo) : '');
  const [tried, setTried] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [server, setServer] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const vendors = useOfferVendors(
    vendorType,
    vendorQ.trim(),
    superAdmin ? [] : addZones.map((z) => z.id),
    !offer && scope === 'VENDOR',
  );

  const valueNumber =
    type === 'FREE_DELIVERY'
      ? 0
      : value.trim() === ''
        ? Number.NaN
        : type === 'FLAT'
          ? rupeesToPaise(Number(value))
          : Number(value);
  const terms = {
    title: title.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    code: code.trim() ? code.trim() : null,
    type,
    value: valueNumber,
    maxDiscountPaise: type === 'PERCENT' ? paiseOrNull(maxDiscount) : null,
    minOrderPaise: paiseOrNull(minOrder) ?? 0,
    newCustomersOnly: newOnly,
    paymentMethods: OFFER_PAYMENT_METHODS.filter((m) => methods.includes(m)),
    perCustomerLimit: Number(perCustomer),
    usageLimit: intOrNull(usageLimit),
    budgetPaise: paiseOrNull(budget),
    validFrom: localToIso(from) ?? '',
    validTo: localToIso(to) ?? '',
  };
  const createBody = {
    ...terms,
    scope,
    zoneIds: scope === 'ZONE' ? zoneIds : [],
    ...(scope === 'VENDOR' && vendor ? { vendor: { type: vendorType, id: vendor.id } } : {}),
    ...(scope !== 'VENDOR' && shared
      ? { fundedBy: 'SHARED' as const, vendorSharePct: Number(share) }
      : {}),
  };
  const lockedBody = offer
    ? {
        version: offer.version,
        ...(paiseOrNull(budget) !== offer.budgetPaise ? { budgetPaise: paiseOrNull(budget) } : {}),
        ...(intOrNull(usageLimit) !== offer.usageLimit
          ? { usageLimit: intOrNull(usageLimit) }
          : {}),
        ...(localToIso(to) && localToIso(to) !== offer.validTo ? { validTo: localToIso(to) } : {}),
      }
    : null;
  const parsed = !offer
    ? offerCreateSchema.safeParse(createBody)
    : locked
      ? offerUpdateSchema.safeParse(lockedBody)
      : offerUpdateSchema.safeParse({
          ...terms,
          version: offer.version,
          ...(superAdmin && offer.fundedBy === 'SHARED' ? { vendorSharePct: Number(share) } : {}),
        });
  const issues: Record<string, string> = {};
  if (!parsed.success)
    for (const i of parsed.error.issues) {
      const key = String(i.path[0] ?? '');
      issues[key] ??= FIELD_HELP[key] ?? i.message;
    }
  const shown = (key: string) =>
    server[key] ? (FIELD_HELP[key] ?? server[key]) : tried ? issues[key] : undefined;

  const run = async () => {
    setTried(true);
    if (!parsed.success) {
      if (!issues['']) return;
      setAlert(issues[''] ?? null);
      return;
    }
    setAlert(null);
    setServer({});
    setBusy(true);
    try {
      if (!offer) {
        const created = await client.post('/offers', { body: offerCreateSchema.parse(createBody) });
        toast({
          title: `${created.title} saved as a draft`,
          description: 'Send it for approval when it is ready.',
        });
        await invalidate();
        onCreated?.(created.id);
      } else {
        await client.patch('/offers/{id}', {
          params: { id: offer.id },
          body: offerUpdateSchema.parse(parsed.data),
        });
        toast({ title: `${offer.title} saved` });
        await invalidate();
      }
      onClose();
    } catch (err) {
      if (isApiError(err, 'STALE_VERSION')) await invalidate();
      setServer(fieldErrors(err));
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T extends string>(list: T[], v: T, on: boolean) =>
    on ? [...list, v] : list.filter((x) => x !== v);

  if (offer && locked)
    return (
      <Shell
        title={`Change ${offer.title}`}
        text="An approved offer keeps its terms. You can raise the budget or the total uses, or end it earlier; for anything else, cancel it and create a new one."
        alert={alert}
        busy={busy}
        onClose={onClose}
        footer={
          <Button onClick={() => void run()} disabled={busy}>
            Save changes
          </Button>
        }
      >
        <p className="text-sm text-muted">
          {valueText(offer)} · {whereText(offer)} · paid by {fundingText(offer)}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            label="Budget (₹)"
            hint="Only higher; empty: no budget"
            error={shown('budgetPaise')}
          >
            <Input
              type="number"
              min={1}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </FormField>
          <FormField
            label="Total uses"
            hint="Only higher; empty: no limit"
            error={shown('usageLimit')}
          >
            <Input
              type="number"
              min={1}
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
            />
          </FormField>
          <FormField label="Ends" hint="Only earlier (India time)" error={shown('validTo')}>
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </div>
      </Shell>
    );

  return (
    <Shell
      title={offer ? `Edit ${offer.title}` : 'New offer'}
      text={
        offer
          ? offer.status === 'REJECTED'
            ? 'Saving makes it a draft again; send it for approval when it is ready.'
            : 'Where it runs and who pays stay as created.'
          : superAdmin
            ? 'It starts as a draft. When you send your own offer it is scheduled without an approval.'
            : 'It starts as a draft. When you send it, a Super Admin approves or rejects it.'
      }
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button onClick={() => void run()} disabled={busy}>
          {offer ? 'Save offer' : 'Save draft'}
        </Button>
      }
    >
      {offer ? (
        <p className="text-sm text-muted">
          {whereText(offer)} · paid by {fundingText(offer)}
        </p>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Where it runs</legend>
            <div className="flex flex-wrap gap-4">
              {(superAdmin
                ? (['PLATFORM', 'ZONE', 'VENDOR'] as const)
                : (['ZONE', 'VENDOR'] as const)
              ).map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === s}
                    onChange={() => {
                      setScope(s);
                      if (s === 'VENDOR') setShared(false);
                    }}
                  />
                  {SCOPE_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>
          {scope === 'ZONE' ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Zones</legend>
              {superAdmin && zoneOptions.isError ? (
                <p className="text-sm text-danger">The zones could not be loaded.</p>
              ) : superAdmin && !zoneOptions.data ? (
                <p className="text-sm text-muted">Loading the zones…</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {zones.map((z) => (
                    <label key={z.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={zoneIds.includes(z.id)}
                        onChange={(e) => setZoneIds(toggle(zoneIds, z.id, e.target.checked))}
                      />
                      {z.name} ({z.code})
                    </label>
                  ))}
                </div>
              )}
              {shown('zoneIds') ? <p className="text-xs text-danger">{shown('zoneIds')}</p> : null}
            </fieldset>
          ) : null}
          {scope === 'VENDOR' ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Vendor (pays for the discount)</legend>
              <div className="flex flex-wrap gap-3">
                <select
                  aria-label="Vendor type"
                  className={inputClass('min-w-36')}
                  value={vendorType}
                  onChange={(e) => {
                    setVendorType(e.target.value as OfferVendorType);
                    setVendor(null);
                  }}
                >
                  {OFFER_VENDOR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'RESTAURANT' ? 'Restaurant' : 'Home Food'}
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  aria-label="Find the vendor"
                  className={inputClass('min-w-56 flex-1')}
                  placeholder="Vendor name"
                  value={vendorQ}
                  onChange={(e) => setVendorQ(e.target.value)}
                />
              </div>
              {vendor ? (
                <p className="text-sm">
                  Picked: <span className="font-semibold">{vendor.name}</span>{' '}
                  <Button variant="ghost" size="sm" onClick={() => setVendor(null)}>
                    Change
                  </Button>
                </p>
              ) : (
                <ul className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-line">
                  {(vendors.data ?? []).map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
                        onClick={() => setVendor({ id: v.id, name: v.name })}
                      >
                        {v.name}
                        {v.zoneCode ? (
                          <span className="ml-2 text-xs text-muted">{v.zoneCode}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {vendors.data && vendors.data.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted">No active vendor matches.</li>
                  ) : null}
                </ul>
              )}
              {shown('vendor') ? <p className="text-xs text-danger">{shown('vendor')}</p> : null}
            </fieldset>
          ) : null}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Title" error={shown('title')}>
          <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField
          label="Code (optional)"
          hint="Empty: applied automatically"
          error={shown('code')}
        >
          <Input
            value={code}
            maxLength={20}
            className="font-mono uppercase"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </FormField>
        <FormField label="Kind">
          <select
            className={inputClass()}
            value={type}
            onChange={(e) => setType(e.target.value as OfferType)}
          >
            {OFFER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </FormField>
        {type === 'FREE_DELIVERY' ? null : (
          <FormField
            label={type === 'PERCENT' ? 'Percent off' : 'Amount off (₹)'}
            error={shown('value')}
          >
            <Input
              type="number"
              min={1}
              step={type === 'PERCENT' ? 1 : 0.01}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </FormField>
        )}
        {type === 'PERCENT' ? (
          <FormField label="Most off one order (₹, optional)" error={shown('maxDiscountPaise')}>
            <Input
              type="number"
              min={1}
              value={maxDiscount}
              onChange={(e) => setMaxDiscount(e.target.value)}
            />
          </FormField>
        ) : null}
        <FormField label="Minimum order (₹)" hint="Empty: any order">
          <Input
            type="number"
            min={0}
            value={minOrder}
            onChange={(e) => setMinOrder(e.target.value)}
          />
        </FormField>
        <FormField label="Starts (India time)" error={shown('validFrom')}>
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="Ends (India time)" error={shown('validTo')}>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <FormField label="Uses per customer" error={shown('perCustomerLimit')}>
          <Input
            type="number"
            min={1}
            max={100}
            value={perCustomer}
            onChange={(e) => setPerCustomer(e.target.value)}
          />
        </FormField>
        <FormField label="Total uses (optional)" error={shown('usageLimit')}>
          <Input
            type="number"
            min={1}
            value={usageLimit}
            onChange={(e) => setUsageLimit(e.target.value)}
          />
        </FormField>
        <FormField
          label="Budget (₹, optional)"
          hint="The offer pauses when it is spent"
          error={shown('budgetPaise')}
        >
          <Input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Description (optional)">
        <textarea
          className={inputClass('min-h-16 py-2')}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
        Only customers who have not had an order delivered yet
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Payment methods</legend>
        <p className="text-xs text-muted">None ticked: every method.</p>
        <div className="flex flex-wrap gap-3">
          {OFFER_PAYMENT_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={methods.includes(m)}
                onChange={(e) => setMethods(toggle(methods, m, e.target.checked))}
              />
              {PAYMENT_LABEL[m]}
            </label>
          ))}
        </div>
      </fieldset>
      {superAdmin && ((!offer && scope !== 'VENDOR') || offer?.fundedBy === 'SHARED') ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Who pays</legend>
          {offer ? null : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Share the cost with the vendors (otherwise ZOAURO pays)
            </label>
          )}
          {shared ? (
            <FormField label="Vendor’s share (%)" error={shown('vendorSharePct')}>
              <Input
                type="number"
                min={1}
                max={99}
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
            </FormField>
          ) : null}
        </fieldset>
      ) : null}
    </Shell>
  );
}

// ---- submit, approve, reject, pause, resume, cancel, delete ---------------------------------------------------------

const ACTION_COPY: Record<
  Exclude<OfferAction, 'edit'>,
  {
    title: string;
    text: string;
    button: string;
    reason: 'none' | 'optional' | 'required';
    toast: string;
  }
> = {
  submit: {
    title: 'Send this offer?',
    text: 'A Super Admin then approves or rejects it. A Super Admin’s own offer is scheduled straight away.',
    button: 'Send',
    reason: 'none',
    toast: 'Offer sent',
  },
  approve: {
    title: 'Approve this offer?',
    text: 'It goes live at its start time. Asks for your password.',
    button: 'Approve',
    reason: 'optional',
    toast: 'Offer approved',
  },
  reject: {
    title: 'Reject this offer?',
    text: 'Say why; the person who asked sees it and can change the offer. Asks for your password.',
    button: 'Reject',
    reason: 'required',
    toast: 'Offer rejected',
  },
  pause: {
    title: 'Pause this offer?',
    text: 'Customers cannot use it until it is resumed. Say why.',
    button: 'Pause',
    reason: 'required',
    toast: 'Offer paused',
  },
  resume: {
    title: 'Resume this offer?',
    text: 'Customers can use it again.',
    button: 'Resume',
    reason: 'required',
    toast: 'Offer live again',
  },
  cancel: {
    title: 'Cancel this offer?',
    text: 'It stops for good; uses so far stay on record. Say why.',
    button: 'Cancel offer',
    reason: 'required',
    toast: 'Offer cancelled',
  },
  delete: {
    title: 'Delete this offer?',
    text: 'Nobody has used it, so it can be removed from the lists. The audit log keeps it.',
    button: 'Delete',
    reason: 'none',
    toast: 'Offer deleted',
  },
};

export function OfferActionDialog({
  offer,
  action,
  onClose,
  onDeleted,
}: {
  offer: Offer;
  action: Exclude<OfferAction, 'edit'>;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateOffers();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const copy = ACTION_COPY[action];
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = { id: offer.id };
  const version = offer.version;
  const reasonOk = copy.reason !== 'required' || reason.trim().length >= 3;

  const run = async () => {
    setTried(true);
    if (!reasonOk) return;
    setAlert(null);
    setBusy(true);
    try {
      const r = reason.trim();
      if (action === 'submit')
        await client.post('/offers/{id}/submit', { params, body: { version } });
      else if (action === 'approve')
        await guarded('Approve the offer', 'PASSWORD', async () => {
          await client.post('/offers/{id}/approve', {
            params,
            body: offerDecisionSchema.parse({ version, ...(r ? { reason: r } : {}) }),
          });
        });
      else if (action === 'reject')
        await guarded('Reject the offer', 'PASSWORD', async () => {
          await client.post('/offers/{id}/reject', {
            params,
            body: offerReasonSchema.parse({ version, reason: r }),
          });
        });
      else if (action === 'delete')
        await client.delete('/offers/{id}', { params, body: { version } });
      else {
        const body = offerReasonSchema.parse({ version, reason: r });
        if (action === 'pause') await client.post('/offers/{id}/pause', { params, body });
        else if (action === 'resume') await client.post('/offers/{id}/resume', { params, body });
        else await client.post('/offers/{id}/cancel', { params, body });
      }
      toast({ title: copy.toast });
      await invalidate();
      if (action === 'delete') onDeleted?.();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      if (isApiError(err, 'STALE_VERSION')) await invalidate();
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Shell
        title={copy.title}
        text={copy.text}
        alert={alert}
        busy={busy}
        onClose={onClose}
        footer={
          <Button
            variant={
              action === 'reject' || action === 'cancel' || action === 'delete'
                ? 'danger'
                : 'primary'
            }
            onClick={() => void run()}
            disabled={busy}
          >
            {copy.button}
          </Button>
        }
      >
        <p className="text-sm">
          <span className="font-semibold">{offer.title}</span> · {valueText(offer)} ·{' '}
          {whereText(offer)}
        </p>
        {copy.reason === 'none' ? null : (
          <FormField
            label={copy.reason === 'required' ? 'Reason' : 'Note (optional)'}
            error={tried && !reasonOk ? 'Say why, in at least 3 characters.' : undefined}
          >
            <textarea
              className={inputClass('min-h-16 py-2')}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        )}
      </Shell>
      {dialog}
    </>
  );
}
