'use client';

import {
  PLAN_FEATURE_LABELS,
  PLAN_FEATURES,
  PLAN_VENDOR_TYPES,
  VENDOR_PLAN_CYCLES,
  rupeesToPaise,
  vendorPlanCreateSchema,
  vendorPlanUpdateSchema,
  type PlanFeature,
  type PlanVendorType,
  type VendorPlan,
  type VendorPlanCycle,
  type VendorPlanSubscription,
} from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { useZoneOptions } from '../platform-settings/api';
import { useInvalidatePlans, useVendorCandidates } from './api';
import {
  CYCLE_LABEL,
  FEATURE_VALUE,
  VENDOR_TYPE_LABEL,
  VENDOR_TYPE_ONE,
  priceText,
} from './labels';

// Vendor plan changes, Super Admin only (D188): create a plan (as a draft) or edit one (at its version; a new price
// applies to vendors who join later), activate or retire it, put a vendor on an active plan (a trial first when the plan
// has one; one live plan per vendor) and cancel a vendor's plan. Nothing is reported as done unless the API says so.

const problem = (err: unknown): string => {
  if (isApiError(err, 'STALE_VERSION'))
    return 'This changed a moment ago. It has been reloaded: check it and try again.';
  if (isApiError(err, 'CONFLICT'))
    return err.message || 'That clashes with what is already there (for example the code).';
  return isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN;
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

/** What to say under a field the schema refused (the code keeps the schema's own message). */
const FIELD_PROBLEM: Record<string, string> = {
  name: 'Use 2 to 60 characters.',
  description: 'Use up to 300 characters.',
  pricePaise: 'Enter a price in rupees: 0 for free, up to ₹10,00,000.',
  trialDays: 'Use 0 to 90 days.',
  vendorTypes: 'Pick at least one vendor type.',
  features: 'Enter a whole, positive amount for each feature that has one.',
  sortOrder: 'Use 0 to 1000.',
};

const rupees = (paise: number) => String(paise / 100);

// ---- create or edit a plan --------------------------------------------------------------------------------------------

export function PlanFormDialog({
  plan,
  onClose,
  onCreated,
}: {
  /** absent: a new plan */
  plan?: VendorPlan;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidatePlans();
  const { toast } = useToast();
  const zoneOptions = useZoneOptions(true);
  const [code, setCode] = useState('');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [price, setPrice] = useState(plan ? rupees(plan.pricePaise) : '');
  const [cycle, setCycle] = useState<VendorPlanCycle>(plan?.cycle ?? 'MONTHLY');
  const [trialDays, setTrialDays] = useState(String(plan?.trialDays ?? 0));
  const [types, setTypes] = useState<PlanVendorType[]>(plan?.vendorTypes ?? []);
  const [zoneIds, setZoneIds] = useState<string[]>(plan?.zones.map((z) => z.id) ?? []);
  const [features, setFeatures] = useState<Partial<Record<PlanFeature, string>>>(() =>
    Object.fromEntries(
      (plan?.features ?? []).map((f) => [
        f.feature,
        f.value === null
          ? ''
          : FEATURE_VALUE[f.feature]?.unit === 'paise'
            ? rupees(f.value)
            : String(f.value),
      ]),
    ),
  );
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0));
  const [tried, setTried] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const featureList = PLAN_FEATURES.filter((f) => features[f] !== undefined).map((f) => {
    const raw = (features[f] ?? '').trim();
    const unit = FEATURE_VALUE[f]?.unit;
    const value =
      !unit || raw === '' ? null : unit === 'paise' ? rupeesToPaise(Number(raw)) : Number(raw);
    return { feature: f, value };
  });
  const fields = {
    name: name.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    pricePaise: price.trim() === '' ? Number.NaN : rupeesToPaise(Number(price)),
    cycle,
    trialDays: trialDays.trim() === '' ? 0 : Number(trialDays),
    vendorTypes: PLAN_VENDOR_TYPES.filter((t) => types.includes(t)),
    zoneIds,
    features: featureList,
    sortOrder: sortOrder.trim() === '' ? 0 : Number(sortOrder),
  };
  const parsed = plan
    ? vendorPlanUpdateSchema.safeParse({ ...fields, version: plan.version })
    : vendorPlanCreateSchema.safeParse({ code: code.trim().toUpperCase(), ...fields });
  const issues: Record<string, string> = {};
  if (!parsed.success)
    for (const i of [...parsed.error.issues].reverse()) {
      const key = String(i.path[0] ?? '');
      issues[key] = key === 'code' ? i.message : (FIELD_PROBLEM[key] ?? i.message);
    }
  const shown = (key: string) => (tried ? issues[key] : undefined);

  const run = async () => {
    setTried(true);
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      if (plan) {
        await client.patch('/vendor-plans/{id}', {
          params: { id: plan.id },
          body: { ...fields, version: plan.version },
        });
        toast({ title: `${fields.name} saved` });
        await invalidate();
        onClose();
      } else {
        const created = await client.post('/vendor-plans', {
          body: { code: code.trim().toUpperCase(), ...fields },
        });
        toast({
          title: `${created.name} created as a draft`,
          description: 'Activate it to use it.',
        });
        await invalidate();
        onCreated?.(created.id);
        onClose();
      }
    } catch (err) {
      if (isApiError(err, 'STALE_VERSION')) await invalidate();
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T extends string>(list: T[], v: T, on: boolean) =>
    on ? [...list, v] : list.filter((x) => x !== v);

  return (
    <Shell
      title={plan ? `Edit ${plan.name}` : 'New vendor plan'}
      text={
        plan
          ? 'Changes apply to vendors who join from now on; vendors already on the plan keep the price they joined at.'
          : 'A new plan starts as a draft: nobody can be put on it until you activate it.'
      }
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button onClick={() => void run()} disabled={busy}>
          {plan ? 'Save plan' : 'Create draft'}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {plan ? null : (
          <FormField
            label="Code"
            hint="Capitals, digits and _, e.g. GROWTH. It never changes."
            error={shown('code')}
          >
            <Input value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} />
          </FormField>
        )}
        <FormField label="Name" error={shown('name')}>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Price (₹)" hint="0 for a free plan" error={shown('pricePaise')}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </FormField>
        <FormField label="Billing cycle">
          <select
            className={inputClass()}
            value={cycle}
            onChange={(e) => setCycle(e.target.value as VendorPlanCycle)}
          >
            {VENDOR_PLAN_CYCLES.map((c) => (
              <option key={c} value={c}>
                {CYCLE_LABEL[c]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Free trial (days)" hint="0 for no trial" error={shown('trialDays')}>
          <Input
            type="number"
            min={0}
            max={90}
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
          />
        </FormField>
        <FormField label="Order in the list" hint="Lower comes first" error={shown('sortOrder')}>
          <Input
            type="number"
            min={0}
            max={1000}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </FormField>
      </div>
      <FormField
        label="Description (optional)"
        hint={plan ? 'Emptying it keeps the current text' : undefined}
        error={shown('description')}
      >
        <textarea
          className={inputClass('min-h-16 py-2')}
          maxLength={300}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FormField>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">For</legend>
        <div className="flex flex-wrap gap-3">
          {PLAN_VENDOR_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={types.includes(t)}
                onChange={(e) => setTypes(toggle(types, t, e.target.checked))}
              />
              {VENDOR_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
        {shown('vendorTypes') ? (
          <p className="text-xs text-danger">{shown('vendorTypes')}</p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Zones</legend>
        <p className="text-xs text-muted">None ticked: the plan is offered in every zone.</p>
        {zoneOptions.isError ? (
          <p className="text-sm text-danger">The zones could not be loaded.</p>
        ) : !zoneOptions.data ? (
          <p className="text-sm text-muted">Loading the zones…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {zoneOptions.data.data.map((z) => (
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
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Included</legend>
        <div className="flex flex-col gap-2">
          {PLAN_FEATURES.map((f) => {
            const on = features[f] !== undefined;
            const value = FEATURE_VALUE[f];
            return (
              <div key={f} className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-56 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setFeatures((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[f] = '';
                        else delete next[f];
                        return next;
                      })
                    }
                  />
                  {PLAN_FEATURE_LABELS[f]}
                </label>
                {on && value ? (
                  <label className="flex items-center gap-2 text-sm text-muted">
                    {value.label}
                    <input
                      type="number"
                      min={0}
                      step={value.unit === 'paise' ? '0.01' : '1'}
                      className={inputClass('h-9 w-28')}
                      value={features[f] ?? ''}
                      onChange={(e) => setFeatures((prev) => ({ ...prev, [f]: e.target.value }))}
                    />
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
        {shown('features') ? <p className="text-xs text-danger">{shown('features')}</p> : null}
      </fieldset>
    </Shell>
  );
}

// ---- activate or retire -----------------------------------------------------------------------------------------------

export function PlanStatusDialog({
  plan,
  to,
  onClose,
}: {
  plan: VendorPlan;
  to: 'ACTIVE' | 'RETIRED';
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidatePlans();
  const { toast } = useToast();
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activate = to === 'ACTIVE';

  const run = async () => {
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/vendor-plans/{id}/status', {
        params: { id: plan.id },
        body: { status: to, version: plan.version },
      });
      toast({ title: activate ? `${plan.name} is active` : `${plan.name} is retired` });
      await invalidate();
      onClose();
    } catch (err) {
      if (isApiError(err, 'STALE_VERSION')) await invalidate();
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={activate ? `Activate ${plan.name}?` : `Retire ${plan.name}?`}
      text={
        activate
          ? `Vendors can be put on it from now on, at ${priceText(plan.pricePaise, plan.cycle)}.`
          : `No vendor can join it any more. The ${plan.subscriberCount} vendor${plan.subscriberCount === 1 ? '' : 's'} on it keep it until they are cancelled. A retired plan cannot be activated again.`
      }
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button
          variant={activate ? 'primary' : 'danger'}
          onClick={() => void run()}
          disabled={busy}
        >
          {activate ? 'Activate' : 'Retire'}
        </Button>
      }
    />
  );
}

// ---- put a vendor on the plan -----------------------------------------------------------------------------------------

export function SubscribeDialog({ plan, onClose }: { plan: VendorPlan; onClose: () => void }) {
  const client = useApiClient();
  const invalidate = useInvalidatePlans();
  const { toast } = useToast();
  const [type, setType] = useState<PlanVendorType>(plan.vendorTypes[0] ?? 'RESTAURANT');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = useVendorCandidates(
    type,
    term,
    plan.zones.map((z) => z.id),
    true,
  );

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const vendor = candidates.data?.find((v) => v.id === vendorId);

  const run = async () => {
    if (!vendor) return;
    setAlert(null);
    setBusy(true);
    try {
      const s = await client.post('/vendor-plans/{id}/subscriptions', {
        params: { id: plan.id },
        body: { vendorType: type, vendorId: vendor.id },
      });
      toast({
        title:
          s.status === 'TRIAL'
            ? `${vendor.name} is on a ${plan.trialDays}-day trial of ${plan.name}`
            : `${vendor.name} is on ${plan.name}`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Put a vendor on ${plan.name}`}
      text={`${priceText(plan.pricePaise, plan.cycle)}${plan.trialDays > 0 ? `, after a ${plan.trialDays}-day free trial` : ''}. A vendor has one live plan at a time.`}
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button onClick={() => void run()} disabled={busy || !vendor}>
          Put on the plan
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <FormField label="Vendor type">
          <select
            className={inputClass('min-w-40')}
            value={type}
            onChange={(e) => {
              setType(e.target.value as PlanVendorType);
              setVendorId('');
            }}
          >
            {plan.vendorTypes.map((t) => (
              <option key={t} value={t}>
                {VENDOR_TYPE_ONE[t]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Find the vendor"
          hint={
            plan.zones.length
              ? `Active vendors in ${plan.zones.map((z) => z.code).join(', ')}`
              : 'Active vendors in every zone'
          }
        >
          <Input
            type="search"
            placeholder="Name or area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </FormField>
      </div>
      {candidates.isError ? (
        <p className="text-sm text-danger">The vendors could not be loaded. Try again.</p>
      ) : !candidates.data ? (
        <p role="status" className="text-sm text-muted">
          Loading vendors…
        </p>
      ) : candidates.data.length === 0 ? (
        <p className="text-sm text-muted">No active vendor matches.</p>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Vendor</legend>
          {candidates.data.map((v) => (
            <label
              key={v.id}
              className="flex items-center gap-3 rounded-input border border-line px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
            >
              <input
                type="radio"
                name="plan-vendor"
                value={v.id}
                checked={vendorId === v.id}
                onChange={() => setVendorId(v.id)}
              />
              <span className="flex-1 font-medium">{v.name}</span>
              <span className="text-xs text-muted">
                {[v.area, v.zoneCode].filter(Boolean).join(' · ')}
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Shell>
  );
}

// ---- cancel a vendor's plan -------------------------------------------------------------------------------------------

export function CancelSubscriptionDialog({
  sub,
  onClose,
}: {
  sub: VendorPlanSubscription;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidatePlans();
  const { toast } = useToast();
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/vendor-plan-subscriptions/{id}/cancel', {
        params: { id: sub.id },
        body: { version: sub.version },
      });
      toast({ title: `${sub.vendor.name} is off ${sub.plan.name}` });
      await invalidate();
      onClose();
    } catch (err) {
      if (isApiError(err, 'STALE_VERSION')) await invalidate();
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Cancel ${sub.vendor.name}'s plan?`}
      text={`${sub.vendor.name} leaves ${sub.plan.name} now. They can be put on a plan again later.`}
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button variant="danger" onClick={() => void run()} disabled={busy}>
          Cancel the plan
        </Button>
      }
    />
  );
}
