'use client';

import {
  MAX_DELIVERY_CHARGE_PAISE,
  ZONE_DESCRIPTION_MAX,
  ZONE_NAME,
  ZONE_PALETTE,
  createZoneSchema,
  paiseToRupees,
  patchZoneSchema,
  rupeesToPaise,
  type ZoneDto,
} from '@zoauro/shared';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateZones } from './api';
import { PincodeEditor, type PincodeValue } from './PincodeEditor';

// Add / Edit zone (doc 53 section 6, doc 22 zone form). Validation is the shared Zod schema the API uses. The code is
// fixed after creation (R-ZONE-3). The delivery charge is typed in rupees and stored in paise. On create, pincodes come
// from a range and/or a list; on edit they are managed on the zone's Pincodes tab. Server errors map to fields:
// ZONE_NAME_TAKEN, ZONE_CODE_TAKEN, PINCODE_OVERLAP, RANGE_TOO_LARGE, STALE_VERSION.

interface Draft {
  name: string;
  code: string;
  city: string;
  state: string;
  charge: string;
  colorHex: string;
  description: string;
  status: 'UPCOMING' | 'ACTIVE';
  pincodes: PincodeValue;
}

const EMPTY: Draft = {
  name: '',
  code: '',
  city: '',
  state: '',
  charge: '0',
  colorHex: ZONE_PALETTE[1].hex,
  description: '',
  status: 'UPCOMING',
  pincodes: { from: '', to: '', extra: [] },
};

function fromZone(z: ZoneDto): Draft {
  return {
    name: z.name,
    code: z.code,
    city: z.city,
    state: z.state ?? '',
    charge: String(paiseToRupees(z.deliveryChargePaise)),
    colorHex: z.colorHex,
    description: z.description ?? '',
    status: 'UPCOMING',
    pincodes: { from: '', to: '', extra: [] },
  };
}

/** "45" or "45.5" rupees → paise; null when not a valid amount. */
export function parseRupees(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return rupeesToPaise(Number(t));
}

type Errors = Partial<Record<keyof Draft | 'form', string>>;

const FRIENDLY: Record<string, string> = {
  ZONE_NAME_TAKEN: 'Another zone already has this name.',
  ZONE_CODE_TAKEN: 'This code is already used (deleted zones keep their codes).',
  PINCODE_OVERLAP: 'Some pincodes already belong to another zone. Remove the ones marked in red.',
  RANGE_TOO_LARGE: 'A range may hold at most 2,000 pincodes.',
  STALE_VERSION:
    'Someone else changed this zone a moment ago. Close and open it again to see their change.',
  ZONE_NOT_ACTIVATABLE:
    'An active zone needs a name, city, state, at least one pincode and a delivery charge.',
};

export function ZoneFormDialog({
  open,
  zone,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** edit this zone; absent = create */
  zone?: ZoneDto;
  onClose: () => void;
  onSaved?: (z: ZoneDto) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateZones();
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const editing = zone !== undefined;

  useEffect(() => {
    if (!open) return;
    setD(zone ? fromZone(zone) : EMPTY);
    setErrors({});
  }, [open, zone]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function submit() {
    setErrors({});
    const paise = parseRupees(d.charge);
    if (paise === null || paise > MAX_DELIVERY_CHARGE_PAISE) {
      setErrors({
        charge: `Enter an amount from ₹0 to ₹${paiseToRupees(MAX_DELIVERY_CHARGE_PAISE).toLocaleString('en-IN')}.`,
      });
      return;
    }
    const common = {
      name: d.name.trim(),
      city: d.city.trim(),
      state: d.state.trim(),
      deliveryChargePaise: paise,
      colorHex: d.colorHex,
    };
    setBusy(true);
    try {
      let saved: ZoneDto;
      if (zone) {
        const body = {
          version: zone.version,
          ...common,
          description: d.description.trim() === '' ? null : d.description.trim(),
        };
        const parsed = patchZoneSchema.safeParse(body);
        if (!parsed.success) {
          setErrors(mapIssues(parsed.error.issues));
          return;
        }
        saved = await client.patch('/zones/{id}', { params: { id: zone.id }, body: parsed.data });
        toast({ title: 'Zone updated', description: `${saved.name} was saved.` });
      } else {
        const body = {
          ...common,
          code: d.code.trim().toUpperCase(),
          status: d.status,
          ...(d.description.trim() ? { description: d.description.trim() } : {}),
          ...(d.pincodes.from || d.pincodes.to
            ? { pincodeFrom: d.pincodes.from, pincodeTo: d.pincodes.to }
            : {}),
          ...(d.pincodes.extra.length > 0 ? { pincodes: d.pincodes.extra } : {}),
        };
        const parsed = createZoneSchema.safeParse(body);
        if (!parsed.success) {
          setErrors(mapIssues(parsed.error.issues));
          return;
        }
        saved = await client.post('/zones', { body: parsed.data });
        toast({
          title: 'Zone created',
          description: `${saved.name} (${saved.code}) is ${saved.status === 'ACTIVE' ? 'live' : 'ready to launch'}.`,
        });
      }
      await invalidate();
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (isApiError(err)) {
        const friendly = FRIENDLY[err.code];
        const field: keyof Draft | 'form' =
          err.code === 'ZONE_NAME_TAKEN'
            ? 'name'
            : err.code === 'ZONE_CODE_TAKEN'
              ? 'code'
              : err.code === 'PINCODE_OVERLAP' || err.code === 'RANGE_TOO_LARGE'
                ? 'pincodes'
                : 'form';
        if (friendly) setErrors({ [field]: friendly });
        else if (err.code === 'VALIDATION_ERROR' && err.details.length > 0)
          setErrors({ ...mapDetails(err.details), form: 'Check the highlighted fields.' });
        else setErrors({ form: err.message || TRY_AGAIN });
      } else setErrors({ form: TRY_AGAIN });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl" closeLabel="Close the zone form">
        <div>
          <DialogTitle>{editing ? `Edit ${zone.name}` : 'Add a new zone'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'The zone code never changes. Pincodes are edited on the zone’s Pincodes tab.'
              : 'A zone decides which pincodes ZOAURO serves and who manages them. New zones start as Upcoming unless you launch them now.'}
          </DialogDescription>
        </div>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
        >
          {errors.form ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {errors.form}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Zone name"
              error={errors.name}
              hint={`${ZONE_NAME.min}–${ZONE_NAME.max} characters`}
            >
              <Input
                value={d.name}
                maxLength={ZONE_NAME.max}
                onChange={(e) => set('name', e.target.value)}
              />
            </FormField>
            <FormField
              label="Zone code"
              error={errors.code}
              hint={
                editing
                  ? 'Fixed: it appears in order numbers and exports.'
                  : '2–6 letters or digits, starting with a letter, e.g. CHN1'
              }
            >
              <Input
                value={d.code}
                disabled={editing}
                maxLength={6}
                className="uppercase"
                onChange={(e) =>
                  set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }
                aria-describedby={undefined}
              />
            </FormField>
            <FormField label="City" error={errors.city}>
              <Input value={d.city} onChange={(e) => set('city', e.target.value)} />
            </FormField>
            <FormField label="State" error={errors.state}>
              <Input
                value={d.state}
                onChange={(e) => set('state', e.target.value)}
                placeholder="Tamil Nadu"
              />
            </FormField>
            <FormField
              label="Default delivery charge (₹)"
              error={errors.charge}
              hint={`₹0 to ₹${paiseToRupees(MAX_DELIVERY_CHARGE_PAISE).toLocaleString('en-IN')}; 0 means free delivery`}
            >
              <Input
                inputMode="decimal"
                value={d.charge}
                onChange={(e) => set('charge', e.target.value)}
              />
            </FormField>
            {editing ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Status</span>
                <p className="text-sm text-muted">
                  <Badge>{zone.status}</Badge> Use Activate or Deactivate on the zone page.
                </p>
              </div>
            ) : (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Start as</legend>
                <div className="flex gap-2">
                  {(['UPCOMING', 'ACTIVE'] as const).map((s) => (
                    <label
                      key={s}
                      className={cn(
                        'flex h-10 flex-1 cursor-pointer items-center gap-2 rounded-input border px-3 text-sm whitespace-nowrap',
                        d.status === s
                          ? 'border-primary bg-primary-soft font-medium text-primary-strong'
                          : 'border-line',
                      )}
                    >
                      <input
                        type="radio"
                        name="zone-status"
                        checked={d.status === s}
                        onChange={() => set('status', s)}
                        className="accent-primary"
                      />
                      {s === 'UPCOMING' ? 'Upcoming' : 'Active now'}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Colour (chips and charts)</legend>
            <div className="flex flex-wrap gap-2">
              {ZONE_PALETTE.map((c) => (
                <label key={c.hex} className="cursor-pointer" title={c.token}>
                  <input
                    type="radio"
                    name="zone-colour"
                    value={c.hex}
                    checked={d.colorHex === c.hex}
                    onChange={() => set('colorHex', c.hex)}
                    className="peer sr-only"
                    aria-label={c.token}
                  />
                  <span
                    aria-hidden
                    className="block size-8 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-text peer-focus-visible:outline-2 peer-focus-visible:outline-primary"
                    style={{ backgroundColor: c.hex }}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          {editing ? null : (
            <PincodeEditor
              value={d.pincodes}
              onChange={(v) => set('pincodes', v)}
              error={errors.pincodes}
            />
          )}

          <FormField
            label="Description (optional)"
            error={errors.description}
            hint={`Up to ${ZONE_DESCRIPTION_MAX} characters`}
          >
            <textarea
              rows={3}
              maxLength={ZONE_DESCRIPTION_MAX}
              value={d.description}
              onChange={(e) => set('description', e.target.value)}
              className={inputClass('resize-y')}
            />
          </FormField>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create zone'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_OF: Record<string, keyof Draft> = {
  name: 'name',
  code: 'code',
  city: 'city',
  state: 'state',
  deliveryChargePaise: 'charge',
  colorHex: 'colorHex',
  description: 'description',
  pincodeFrom: 'pincodes',
  pincodeTo: 'pincodes',
  pincodes: 'pincodes',
};

function mapIssues(issues: readonly { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = FIELD_OF[String(i.path[0] ?? '')] ?? 'form';
    out[key] ??= humanise(String(i.path[0] ?? ''), i.message);
  }
  return out;
}

function mapDetails(details: readonly { field: string; issue: string }[]): Errors {
  const out: Errors = {};
  for (const d of details) {
    const key = FIELD_OF[d.field.split('.')[0] ?? ''] ?? 'form';
    out[key] ??= humanise(d.field, d.issue);
  }
  return out;
}

function humanise(field: string, message: string): string {
  if (message === 'RANGE_TOO_LARGE') return FRIENDLY['RANGE_TOO_LARGE'] ?? message;
  if (field === 'code') return 'Use 2–6 letters or digits, starting with a letter.';
  if (/too_small|at least|>=|Too small/i.test(message)) return 'This is required or too short.';
  if (/too_big|at most|<=|Too big/i.test(message)) return 'This is too long.';
  return message.charAt(0).toUpperCase() + message.slice(1);
}
