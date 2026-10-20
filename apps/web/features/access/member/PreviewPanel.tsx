'use client';

import { PERMISSION_MODULES, type AccessPreview, type PermissionModule } from '@zoauro/shared';
import { Info, Lock, ShieldCheck } from 'lucide-react';
import { useId } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import { inputClass } from '../../../components/ui/input';
import { formatPaise } from '../../audit/format';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { useAccessPreview } from './api';
import type { ZoneRef } from './draft';
import { ACTION_LABEL, moduleLabel, NEVER_GRANTABLE } from './labels';

// What the member can really do in one zone (D108, TC-AC-11), from the same resolver every request uses. It shows the
// SAVED state: unsaved edits appear after Save.

export function PreviewPanel({
  memberId,
  zones,
  zoneId,
  onZone,
  dirty,
}: {
  memberId: string;
  zones: ZoneRef[];
  zoneId: string | null;
  onZone: (id: string) => void;
  dirty: boolean;
}) {
  const selectId = useId();
  const preview = useAccessPreview(memberId, zoneId);
  return (
    <Card aria-labelledby="access-preview">
      <CardHeader
        id="access-preview"
        title="Effective access"
        subtitle="What the member can do, as saved"
      />
      <CardBody className="flex flex-col gap-4">
        {zones.length === 0 ? (
          <EmptyState icon={<ShieldCheck aria-hidden className="size-5" />} title="Nothing saved">
            Save a zone to preview the member&apos;s access there.
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={selectId} className="text-sm font-medium">
                Zone
              </label>
              <select
                id={selectId}
                value={zoneId ?? ''}
                onChange={(e) => onZone(e.target.value)}
                className={inputClass()}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.code})
                  </option>
                ))}
              </select>
            </div>
            {dirty ? (
              <p className="flex items-start gap-2 rounded-input bg-info-soft p-3 text-xs text-info">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" /> You have unsaved changes.
                Save to preview changes.
              </p>
            ) : null}
            {preview.isError ? (
              <CardError what="The preview" onRetry={() => void preview.refetch()} />
            ) : !preview.data ? (
              <CardSkeleton rows={5} />
            ) : (
              <PreviewBody preview={preview.data} />
            )}
          </>
        )}
        <Legend />
      </CardBody>
    </Card>
  );
}

function PreviewBody({ preview: p }: { preview: AccessPreview }) {
  if (!p.assigned)
    return <p className="text-sm text-muted">The member has no saved access in this zone.</p>;
  const byModule = new Map<PermissionModule, AccessPreview['matrix']>();
  for (const cell of p.matrix) {
    // effective cells, and the ones an override took away
    if (!cell.effective && cell.override !== 'DENY') continue;
    byModule.set(cell.module, [...(byModule.get(cell.module) ?? []), cell]);
  }
  const modules = PERMISSION_MODULES.filter((m) => byModule.has(m));
  return (
    <div className="flex flex-col gap-4 text-sm">
      <section aria-label="Limits">
        <h3 className="mb-1.5 text-xs font-semibold text-muted uppercase">Limits</h3>
        <dl className="grid grid-cols-2 gap-2">
          <Fact label="Per refund" value={formatPaise(p.limits.perRefund)} />
          <Fact label="Per day" value={formatPaise(p.limits.dailyRefund)} />
          <Fact label="Reveal contacts" value={p.limits.canReveal ? 'Yes' : 'No'} />
          <Fact label="Export" value={p.limits.canExport ? 'Yes' : 'No'} />
        </dl>
      </section>
      <section aria-label="Visible modules">
        <h3 className="mb-1.5 text-xs font-semibold text-muted uppercase">Visible modules</h3>
        {p.visibleModules.length === 0 ? (
          <p className="text-muted">None: the member sees an empty sidebar here.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {p.visibleModules.map((m) => (
              <li key={m}>
                <Badge tone="brand">{moduleLabel(m)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Permissions">
        <h3 className="mb-1.5 text-xs font-semibold text-muted uppercase">Permissions</h3>
        {modules.length === 0 ? (
          <p className="text-muted">No permissions in this zone.</p>
        ) : (
          <ul className="divide-y divide-line">
            {modules.map((m) => (
              <li key={m} className="flex flex-wrap items-center gap-1.5 py-1.5">
                <span className="w-32 shrink-0 font-medium">{moduleLabel(m)}</span>
                {(byModule.get(m) ?? []).map((c) =>
                  c.override === 'DENY' ? (
                    <Badge key={c.action} tone="danger" className="line-through">
                      {ACTION_LABEL[c.action]}
                      <span className="sr-only"> denied by override</span>
                    </Badge>
                  ) : (
                    <Badge key={c.action} tone={c.override === 'GRANT' ? 'success' : 'neutral'}>
                      {ACTION_LABEL[c.action]}
                      {c.override === 'GRANT' ? (
                        <>
                          <span aria-hidden> +</span>
                          <span className="sr-only"> granted by override</span>
                        </>
                      ) : null}
                    </Badge>
                  ),
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-input bg-surface-muted px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Legend() {
  return (
    <div className="border-t border-line pt-3 text-xs text-muted">
      <p className="mb-1.5 font-semibold uppercase">Legend</p>
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-2">
          <Badge>View</Badge> from the profile
        </li>
        <li className="flex items-center gap-2">
          <Badge tone="success">View +</Badge> granted by an override
        </li>
        <li className="flex items-center gap-2">
          <Badge tone="danger" className="line-through">
            View
          </Badge>{' '}
          removed by an override (deny wins)
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-flex h-5 w-8 items-center justify-center rounded-input bg-surface-muted">
            <Lock aria-hidden className="size-3" />
          </span>
          {NEVER_GRANTABLE} (locked in the overrides)
        </li>
      </ul>
    </div>
  );
}
