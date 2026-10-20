'use client';

import {
  ZONE_PINCODE_PAGE_MAX,
  isValidPincode,
  parsePincodeList,
  type ZoneDto,
} from '@zoauro/shared';
import { CircleAlert, Eye, MapPin, Search } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { formatTimestamp } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, EmptyState } from '../dashboard/parts';
import { useInvalidateZones, useZone } from './api';

// Pincodes tab of the zone page (doc 53 sections 2.3 and 6): the paged, searchable list, and changes made in two steps,
// a preview (PUT ?preview=true writes nothing) then the save. A range edit touches only range-made rows; removing a
// pincode never moves vendors or partners registered there (they are listed as mismatches).

type Mode = 'add' | 'remove' | 'range';

interface Preview {
  added: string[];
  removed: string[];
  conflicts: { pincode: string; zoneName: string }[];
  mismatches: { entityType: string; name: string; pincode: string }[];
}

export function PincodesTab({ zone }: { zone: ZoneDto }) {
  const client = useApiClient();
  const invalidate = useInvalidateZones();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const prefix = /^\d{1,6}$/.test(q.trim()) ? q.trim() : undefined;
  const detail = useZone(zone.id, prefix, page);
  const [mode, setMode] = useState<Mode>('add');
  const [text, setText] = useState('');
  const [from, setFrom] = useState(zone.pincodeFrom ?? '');
  const [to, setTo] = useState(zone.pincodeTo ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = (): Record<string, unknown> | null => {
    if (mode === 'range') {
      if (!isValidPincode(from) || !isValidPincode(to)) return null;
      return { range: { from, to } };
    }
    const { valid } = parsePincodeList(text);
    if (valid.length === 0) return null;
    return mode === 'add' ? { add: valid } : { remove: valid };
  };

  async function run(dry: boolean) {
    const b = body();
    if (!b) {
      setError(
        mode === 'range'
          ? 'Enter two valid 6-digit pincodes.'
          : 'Enter at least one valid pincode.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await client.put('/zones/{id}/pincodes', {
        params: { id: zone.id },
        query: { preview: dry ? 'true' : 'false' },
        body: b,
      });
      if (dry) {
        setPreview({
          added: r.added,
          removed: r.removed,
          conflicts: r.conflicts.map((c) => ({ pincode: c.pincode, zoneName: c.zoneName })),
          mismatches: r.mismatches,
        });
      } else {
        toast({
          title: 'Pincodes saved',
          description: `${r.added.length} added, ${r.removed.length} removed.`,
        });
        setPreview(null);
        setText('');
        await invalidate();
      }
    } catch (err) {
      setError(
        isApiError(err, 'PINCODE_OVERLAP')
          ? 'Some pincodes belong to another zone. Run the preview to see which.'
          : isApiError(err, 'RANGE_TOO_LARGE')
            ? 'A range may hold at most 2,000 pincodes.'
            : isApiError(err)
              ? err.message
              : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = detail.data?.pincodes.data ?? [];
  const meta = detail.data?.pincodes.meta;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <section aria-labelledby="pin-list" className="xl:col-span-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="pin-list" className="text-base font-semibold">
            {zone.pincodeCount.toLocaleString('en-IN')} pincodes
          </h2>
          <div className="relative w-56">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              inputMode="numeric"
              aria-label="Find pincodes starting with"
              placeholder="Starts with…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value.replace(/\D/g, '').slice(0, 6));
                setPage(1);
              }}
              className={inputClass('h-9 pl-9')}
            />
          </div>
        </div>
        {detail.isError ? (
          <CardError what="The pincode list" onRetry={() => void detail.refetch()} />
        ) : rows.length === 0 && !detail.isPending ? (
          <EmptyState
            icon={<MapPin aria-hidden className="size-5" />}
            title={prefix ? 'No pincode matches' : 'No pincodes yet'}
          >
            {prefix ? 'Try fewer digits.' : 'Add a range or individual pincodes with the editor.'}
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-input border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">Pincodes of {zone.name}</caption>
              <thead className="bg-surface-muted text-left text-xs font-semibold text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2.5">
                    Pincode
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    Added from
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    Added on
                  </th>
                </tr>
              </thead>
              <tbody className={cn('divide-y divide-line', detail.isFetching && 'opacity-70')}>
                {rows.map((p) => (
                  <tr key={p.pincode}>
                    <td className="px-4 py-2 font-medium tabular-nums">{p.pincode}</td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          p.source === 'RANGE'
                            ? 'info'
                            : p.source === 'MANUAL'
                              ? 'brand'
                              : 'neutral'
                        }
                      >
                        {p.source === 'RANGE'
                          ? 'Range'
                          : p.source === 'MANUAL'
                            ? 'Typed'
                            : 'Import'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted">{formatTimestamp(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 ? (
              <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
                <span>
                  Page {page} of {pages} · {meta?.total.toLocaleString('en-IN')} pincodes (up to{' '}
                  {Math.min(100, ZONE_PINCODE_PAGE_MAX)} a page)
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </span>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section aria-labelledby="pin-edit" className="xl:col-span-2">
        <div className="rounded-card border border-line bg-surface-muted p-5">
          <h2 id="pin-edit" className="text-base font-semibold">
            Change pincodes
          </h2>
          <p className="mt-1 text-sm text-muted">
            Preview first: nothing is saved until you confirm.
          </p>
          <div
            role="radiogroup"
            aria-label="Change"
            className="mt-4 grid grid-cols-3 gap-1 rounded-input bg-surface p-1"
          >
            {(
              [
                ['add', 'Add'],
                ['remove', 'Remove'],
                ['range', 'Set range'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m);
                  setPreview(null);
                  setError(null);
                }}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-sm font-medium',
                  mode === m ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'range' ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                From
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value.replace(/\D/g, ''));
                    setPreview(null);
                  }}
                  className={inputClass()}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                To
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value.replace(/\D/g, ''));
                    setPreview(null);
                  }}
                  className={inputClass()}
                />
              </label>
              <p className="col-span-2 text-xs text-muted">
                Replaces the range-made pincodes only; typed or imported ones stay.
              </p>
            </div>
          ) : (
            <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium">
              {mode === 'add' ? 'Pincodes to add' : 'Pincodes to remove'}
              <textarea
                rows={4}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                placeholder="Separated by commas, spaces or new lines"
                className={inputClass('resize-y')}
              />
            </label>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}

          {preview ? <PreviewBox preview={preview} /> : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void run(true)}>
              <Eye aria-hidden className="size-4" /> Preview
            </Button>
            <Button
              disabled={
                busy ||
                !preview ||
                preview.conflicts.length > 0 ||
                (preview.added.length === 0 && preview.removed.length === 0)
              }
              onClick={() => void run(false)}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PreviewBox({ preview }: { preview: Preview }) {
  const list = (items: string[]) =>
    items.length === 0
      ? 'none'
      : `${items.slice(0, 12).join(', ')}${items.length > 12 ? ` and ${items.length - 12} more` : ''}`;
  return (
    <div
      role="status"
      className="mt-4 flex flex-col gap-2 rounded-input border border-line bg-surface p-3 text-sm"
    >
      <p>
        <span className="font-semibold text-success">+{preview.added.length} added:</span>{' '}
        <span className="text-muted">{list(preview.added)}</span>
      </p>
      <p>
        <span className="font-semibold text-danger">−{preview.removed.length} removed:</span>{' '}
        <span className="text-muted">{list(preview.removed)}</span>
      </p>
      {preview.conflicts.length > 0 ? (
        <div className="rounded-input bg-danger-soft p-2.5 text-danger">
          <p className="font-semibold">Owned by other zones — cannot save:</p>
          <ul className="mt-1 list-inside list-disc">
            {preview.conflicts.slice(0, 10).map((c) => (
              <li key={c.pincode}>
                {c.pincode} in {c.zoneName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.mismatches.length > 0 ? (
        <div className="rounded-input bg-warning-soft p-2.5 text-warning">
          <p className="font-semibold">Registered at removed pincodes (they stay in this zone):</p>
          <ul className="mt-1 list-inside list-disc">
            {preview.mismatches.slice(0, 10).map((m) => (
              <li key={`${m.entityType}-${m.name}-${m.pincode}`}>
                {m.name} ({m.entityType}) at {m.pincode}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
