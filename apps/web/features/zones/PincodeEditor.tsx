'use client';

import { MAX_PINCODE_RANGE, expandRange, isValidPincode, parsePincodeList } from '@zoauro/shared';
import { CircleAlert, Loader2, MapPin, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import { inputClass } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { usePincodeOwner } from './api';

// Pincode editor of the zone form (doc 53 section 6, doc 22 zone form): a range (from–to, at most 2000), and pasted or
// typed individual pincodes shown as chips. The live overlap hint asks GET /zones/lookup for each chip, so a pincode
// already owned by another zone is flagged before saving; the server re-checks under its lock on save (PINCODE_OVERLAP).

export interface PincodeValue {
  from: string;
  to: string;
  extra: string[];
}

export function rangeSize(from: string, to: string): number | null {
  if (!isValidPincode(from) || !isValidPincode(to)) return null;
  return Number(to) - Number(from) + 1;
}

export function PincodeEditor({
  value,
  onChange,
  ownZoneId,
  error,
}: {
  value: PincodeValue;
  onChange: (v: PincodeValue) => void;
  /** a pincode owned by this zone is not a conflict */
  ownZoneId?: string;
  error?: string | undefined;
}) {
  const id = useId();
  const [paste, setPaste] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const size = rangeSize(value.from, value.to);
  const range = value.from && value.to ? expandRange(value.from, value.to) : null;

  const add = () => {
    const parsed = parsePincodeList(paste);
    setInvalid(parsed.invalid);
    const merged = [...new Set([...value.extra, ...parsed.valid])].sort();
    onChange({ ...value, extra: merged });
    setPaste('');
  };

  return (
    <fieldset className="flex flex-col gap-4 rounded-input border border-line p-4">
      <legend className="px-1 text-sm font-semibold">Pincodes</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-from`} className="text-sm font-medium">
            Range from
          </label>
          <input
            id={`${id}-from`}
            inputMode="numeric"
            maxLength={6}
            placeholder="600001"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value.replace(/\D/g, '') })}
            className={inputClass()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-to`} className="text-sm font-medium">
            Range to
          </label>
          <input
            id={`${id}-to`}
            inputMode="numeric"
            maxLength={6}
            placeholder="600040"
            value={value.to}
            aria-describedby={`${id}-range`}
            onChange={(e) => onChange({ ...value, to: e.target.value.replace(/\D/g, '') })}
            className={inputClass()}
          />
        </div>
      </div>
      <p
        id={`${id}-range`}
        className={cn('text-xs', range && !range.ok ? 'font-medium text-danger' : 'text-muted')}
      >
        {range && !range.ok
          ? range.error === 'RANGE_TOO_LARGE'
            ? `A range may hold at most ${MAX_PINCODE_RANGE.toLocaleString('en-IN')} pincodes (this one has ${size?.toLocaleString('en-IN')}).`
            : 'Enter two valid 6-digit pincodes, the second not below the first.'
          : size
            ? `${size.toLocaleString('en-IN')} pincodes in this range.`
            : `Optional. Up to ${MAX_PINCODE_RANGE.toLocaleString('en-IN')} pincodes per range.`}
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-paste`} className="text-sm font-medium">
          Add individual pincodes
        </label>
        <div className="flex gap-2">
          <textarea
            id={`${id}-paste`}
            rows={2}
            placeholder="Paste or type pincodes, separated by commas, spaces or new lines"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            className={inputClass('min-h-10 flex-1 resize-y')}
          />
          <Button variant="secondary" onClick={add} disabled={paste.trim() === ''}>
            Add
          </Button>
        </div>
        {invalid.length > 0 ? (
          <p className="text-xs font-medium text-danger">
            Not valid pincodes, left out: {invalid.slice(0, 10).join(', ')}
            {invalid.length > 10 ? ` and ${invalid.length - 10} more` : ''}
          </p>
        ) : null}
      </div>

      {value.extra.length > 0 ? (
        <ul aria-label="Individual pincodes" className="flex flex-wrap gap-2">
          {value.extra.map((p) => (
            <PincodeChip
              key={p}
              pincode={p}
              ownZoneId={ownZoneId}
              onRemove={() => onChange({ ...value, extra: value.extra.filter((x) => x !== p) })}
            />
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <CircleAlert aria-hidden className="size-3.5" /> {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function PincodeChip({
  pincode,
  ownZoneId,
  onRemove,
}: {
  pincode: string;
  ownZoneId: string | undefined;
  onRemove: () => void;
}) {
  const owner = usePincodeOwner(pincode);
  const zone = owner.data?.zone ?? null;
  const conflict = zone !== null && zone.id !== ownZoneId;
  return (
    <li
      className={cn(
        'flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-3 text-sm',
        conflict ? 'border-red-300 bg-danger-soft text-danger' : 'border-line bg-surface-muted',
      )}
    >
      {owner.isFetching ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin text-muted" />
      ) : conflict ? (
        <CircleAlert aria-hidden className="size-3.5" />
      ) : (
        <MapPin aria-hidden className="size-3.5 text-muted" />
      )}
      <span className="font-medium tabular-nums">{pincode}</span>
      {conflict ? <span className="text-xs">in {zone.name}</span> : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${pincode}`}
        className="rounded-full p-0.5 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}
