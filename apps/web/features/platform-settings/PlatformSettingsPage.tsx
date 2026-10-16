'use client';

import type { SettingGroup } from '@zoauro/shared';
import { History, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button, buttonClass } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { usePlatformSettings, useZoneOptions, useZoneSettings, type SettingItem } from './api';
import { describeValue } from './fields';
import { ResetSettingDialog, SettingEditor, type EditTarget } from './SettingEditor';

// Platform Settings (owner's Control & Governance spec 2.7, doc 59, D109–D116). Every setting shows its value in
// effect, where it comes from (the decided default, the Super Admin's platform value, or a zone's own value) and whether
// the backend uses it yet, so no setting pretends to work before its module exists. The zone picker (?zone=<CODE>)
// shows the keys a zone may override.

export const GROUP_LABEL: Record<SettingGroup, string> = {
  refunds: 'Refunds',
  onboarding: 'Onboarding',
  support: 'Support',
  notifications: 'Notifications',
  orders: 'Orders',
  sms: 'SMS',
  loyalty: 'Loyalty (Phase 2)',
  security: 'Security',
};

const SOURCE: Record<SettingItem['source'], { label: string; tone: BadgeTone }> = {
  DEFAULT: { label: 'Default rule', tone: 'neutral' },
  PLATFORM: { label: 'Set by Super Admin', tone: 'brand' },
  ZONE: { label: "Zone's own value", tone: 'info' },
};

export function effectBadge(s: SettingItem): { label: string; tone: BadgeTone } {
  if (s.effective === null) return { label: 'Not configured', tone: 'warning' };
  if (s.effect.state === 'ENFORCED') return { label: 'Enforced', tone: 'success' };
  return { label: `Applies when ${s.effect.module ?? 'its module'} ships`, tone: 'neutral' };
}

export function PlatformSettingsPage() {
  const url = useUrlState();
  const zoneCode = url.params.get('zone');
  const zones = useZoneOptions();
  const zone = zoneCode ? (zones.data?.data.find((z) => z.code === zoneCode) ?? null) : null;
  const platform = usePlatformSettings();
  const zoneView = useZoneSettings(zone?.id ?? null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [resetting, setResetting] = useState<EditTarget | null>(null);

  const query = zone ? zoneView : platform;
  const settings: SettingItem[] | undefined = zone ? zoneView.data : platform.data?.data;
  const unknownZone = Boolean(zoneCode && zones.data && !zone);
  const groups = [...new Set((settings ?? []).map((s) => s.group))];
  const target = (s: SettingItem): EditTarget => ({
    setting: s,
    zone: zone ? { id: zone.id, name: zone.name, code: zone.code } : null,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform Settings"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Platform Settings' },
        ]}
        description="Each rule follows the decided default until you save a value; a zone's own value applies only in that zone."
        actions={
          <a href="/super-admin/settings/history" className={buttonClass('secondary')}>
            <History aria-hidden className="size-4" /> Settings history
          </a>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Show values for
          <select
            className={inputClass('min-w-64')}
            value={zone?.code ?? ''}
            onChange={(e) => url.patch({ zone: e.target.value || null })}
          >
            <option value="">The whole platform</option>
            {(zones.data?.data ?? []).map((z) => (
              <option key={z.id} value={z.code}>
                {z.name} ({z.code})
              </option>
            ))}
          </select>
        </label>
        {zone ? (
          <p className="pb-2 text-sm text-muted">
            Only settings a zone may override are listed. Without its own value, {zone.name} follows
            the platform value.
          </p>
        ) : null}
      </div>

      {unknownZone ? (
        <Card>
          <CardBody>
            <p className="text-sm">
              No zone with the code {zoneCode}.{' '}
              <button
                type="button"
                className="font-medium text-primary-strong hover:underline"
                onClick={() => url.patch({ zone: null })}
              >
                Show the platform values
              </button>
            </p>
          </CardBody>
        </Card>
      ) : query.isError ? (
        <CardError what="Settings" onRetry={() => void query.refetch()} />
      ) : !settings ? (
        <CardSkeleton rows={6} />
      ) : (
        groups.map((g) => (
          <Card key={g} aria-labelledby={`group-${g}`}>
            <CardHeader id={`group-${g}`} title={GROUP_LABEL[g]} />
            <CardBody className="flex flex-col divide-y divide-line">
              {settings
                .filter((s) => s.group === g)
                .map((s) => (
                  <SettingRow
                    key={s.key}
                    setting={s}
                    inZone={zone !== null}
                    onEdit={() => setEditing(target(s))}
                    onReset={() => setResetting(target(s))}
                  />
                ))}
            </CardBody>
          </Card>
        ))
      )}

      <SettingEditor target={editing} onClose={() => setEditing(null)} />
      <ResetSettingDialog target={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function SettingRow({
  setting: s,
  inZone,
  onEdit,
  onReset,
}: {
  setting: SettingItem;
  inZone: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  const own = inZone ? s.zone : s.platform;
  const source = SOURCE[s.source];
  const effect = effectBadge(s);
  const headingId = `setting-${s.key.replace('.', '-')}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="text-sm font-semibold">
            {s.label}
          </h3>
          <Badge tone={source.tone}>{source.label}</Badge>
          <Badge tone={effect.tone} dot>
            {effect.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted">{s.description}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {describeValue(s.key, s.effective).map((row) => (
            <div
              key={row.label}
              className="flex justify-between gap-3 border-b border-dashed border-line pb-1"
            >
              <dt className="text-muted">{row.label}</dt>
              <dd className="text-right font-medium">{row.text}</dd>
            </div>
          ))}
        </dl>
        {own ? (
          <p className="mt-2 text-xs text-muted">
            Changed by {own.updatedBy?.name ?? 'System'},{' '}
            <time dateTime={own.updatedAt}>{relativeTime(own.updatedAt)}</time>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-start gap-2">
        {s.editable ? (
          <>
            <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`Edit ${s.label}`}>
              <Pencil aria-hidden className="size-4" /> Edit
            </Button>
            {own ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onReset}
                aria-label={
                  inZone ? `Remove the zone's own ${s.label}` : `Reset ${s.label} to the default`
                }
              >
                <RotateCcw aria-hidden className="size-4" /> {inZone ? 'Remove' : 'Reset'}
              </Button>
            ) : null}
          </>
        ) : (
          <a
            href="/super-admin/settings/security"
            className={buttonClass('secondary', undefined, 'sm')}
          >
            <ShieldCheck aria-hidden className="size-4" /> Security settings
          </a>
        )}
      </div>
    </section>
  );
}
