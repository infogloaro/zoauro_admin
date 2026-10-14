'use client';

import { ASSIGNMENT_NOTE_MAX, type AccessProfileSummary } from '@zoauro/shared';
import { ChevronDown, CircleAlert, Eye, Trash2 } from 'lucide-react';
import { useId, useState, type SelectHTMLAttributes } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import { FormField } from '../../../components/ui/field';
import { inputClass } from '../../../components/ui/input';
import { formatPaise } from '../../audit/format';
import { ZONE_STATUS_LABEL, ZONE_STATUS_TONE } from '../../zones/format';
import { parseLimit, type DraftAssignment, type Tri } from './draft';
import { OverrideMatrix } from './OverrideMatrix';

// One zone of the member (D104–D106): profile, refund limits in rupees (empty = the profile default, with the value
// that applies now as a hint), reveal/export flags, the overrides matrix, a note and "Remove zone". Edits stay local
// until the page's Save.

export function AssignmentCard({
  draft: d,
  profiles,
  errors,
  selected,
  onChange,
  onRemove,
  onPreview,
}: {
  draft: DraftAssignment;
  profiles: AccessProfileSummary[];
  errors: string[];
  selected: boolean;
  onChange: (patch: Partial<DraftAssignment>) => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const matrixId = useId();
  const eff = d.saved?.effectiveLimits;
  const overrideCount = Object.keys(d.overrides).length;
  const limitError = (text: string) => {
    const r = parseLimit(text);
    return 'error' in r ? r.error : undefined;
  };
  const limitHint = (paise: number | undefined) =>
    eff && paise !== undefined
      ? `Empty: the profile default. Applies now: ${formatPaise(paise)}.`
      : 'Empty: the profile default.';
  const flagHint = (v: boolean | undefined) =>
    v === undefined ? undefined : `Applies now: ${v ? 'Yes' : 'No'}.`;

  return (
    <Card
      aria-labelledby={`zone-${d.zone.id}`}
      className={selected ? 'ring-2 ring-primary/40' : undefined}
    >
      <CardHeader
        id={`zone-${d.zone.id}`}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ backgroundColor: d.zone.colorHex }}
            />
            {d.zone.name}
            <span className="text-sm font-normal text-muted">{d.zone.code}</span>
          </span>
        }
        subtitle={d.saved ? undefined : 'New: added in this edit, saved with the page.'}
        actions={
          <>
            <Badge tone={ZONE_STATUS_TONE[d.zone.status]} dot>
              {ZONE_STATUS_LABEL[d.zone.status]}
            </Badge>
            {d.saved ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onPreview}
                aria-label={`Preview access in ${d.zone.name}`}
                aria-pressed={selected}
              >
                <Eye aria-hidden className="size-3.5" /> Preview
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={onRemove}
              aria-label={`Remove zone ${d.zone.name}`}
            >
              <Trash2 aria-hidden className="size-3.5" /> Remove zone
            </Button>
          </>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {errors.length > 0 ? (
          <ul role="alert" className="rounded-input bg-danger-soft p-3 text-sm text-danger">
            {errors.map((e) => (
              <li key={e} className="flex items-start gap-2">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {e}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Access profile" className="flex flex-col gap-1.5 sm:col-span-2">
            <select
              value={d.profileId}
              onChange={(e) => onChange({ profileId: e.target.value })}
              className={inputClass()}
            >
              {/* the saved profile stays selectable even when it is missing from the list */}
              {d.saved && !profiles.some((p) => p.id === d.saved?.profile.id) ? (
                <option value={d.saved.profile.id}>{d.saved.profile.name}</option>
              ) : null}
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Per refund limit (₹)"
            hint={limitHint(eff?.perRefund)}
            error={limitError(d.perRefund)}
          >
            <input
              inputMode="decimal"
              value={d.perRefund}
              placeholder="Use profile default"
              onChange={(e) => onChange({ perRefund: e.target.value })}
              className={inputClass()}
            />
          </FormField>
          <FormField
            label="Refunds per day (₹)"
            hint={limitHint(eff?.dailyRefund)}
            error={limitError(d.dailyRefund)}
          >
            <input
              inputMode="decimal"
              value={d.dailyRefund}
              placeholder="Use profile default"
              onChange={(e) => onChange({ dailyRefund: e.target.value })}
              className={inputClass()}
            />
          </FormField>
          <FormField label="Can reveal contacts" hint={flagHint(eff?.canReveal)}>
            <TriSelect value={d.canReveal} onChange={(v) => onChange({ canReveal: v })} />
          </FormField>
          <FormField label="Can export" hint={flagHint(eff?.canExport)}>
            <TriSelect value={d.canExport} onChange={(v) => onChange({ canExport: v })} />
          </FormField>
        </div>

        <div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={matrixId}
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <ChevronDown
              aria-hidden
              className={open ? 'size-4 rotate-180 transition-transform' : 'size-4'}
            />
            Overrides ({overrideCount})
          </button>
          <div id={matrixId} hidden={!open} className="mt-3">
            {open ? (
              <OverrideMatrix
                zoneName={d.zone.name}
                overrides={d.overrides}
                onChange={(key, effect) => {
                  const next = { ...d.overrides };
                  if (effect) next[key] = effect;
                  else delete next[key];
                  onChange({ overrides: next });
                }}
              />
            ) : null}
          </div>
        </div>

        <FormField label="Note" hint={`Optional, at most ${ASSIGNMENT_NOTE_MAX} characters.`}>
          <textarea
            rows={2}
            maxLength={ASSIGNMENT_NOTE_MAX}
            value={d.note}
            onChange={(e) => onChange({ note: e.target.value })}
            className={inputClass('resize-y')}
          />
        </FormField>
      </CardBody>
    </Card>
  );
}

function TriSelect({
  value,
  onChange,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: Tri;
  onChange: (v: Tri) => void;
}) {
  return (
    // FormField passes id and aria-* through `rest`
    <select
      {...rest}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === 'yes' || v === 'no' ? v : 'default');
      }}
      className={inputClass()}
    >
      <option value="default">Profile default</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}
