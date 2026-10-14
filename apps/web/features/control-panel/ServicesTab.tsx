'use client';

import { ZONE_SERVICE_LABELS, type ZoneServiceKind } from '@zoauro/shared';
import { BedDouble, ChefHat, Store, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';
import { formatTimestamp } from '../audit/format';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { ServiceSwitchConfirm } from './ServiceSwitchConfirm';
import { useSwitchService, useZoneServices } from './useZoneServices';

// Services tab of the zone page (D92): each service with its switch, whether the value is still the default, and who
// changed it last. Same rules as the Control Panel: PASSWORD re-auth, confirmation before switching off.

const ICON: Record<ZoneServiceKind, LucideIcon> = {
  RESTAURANTS: Store,
  HOME_FOOD: ChefHat,
  HOTEL_BOOKING: BedDouble,
};

export function ServicesTab({ zone }: { zone: { id: string; name: string } }) {
  const services = useZoneServices(zone.id);
  const { switchService, dialog } = useSwitchService();
  const [confirm, setConfirm] = useState<ZoneServiceKind | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (service: ZoneServiceKind, on: boolean) => {
    setBusy(true);
    await switchService(zone, service, ZONE_SERVICE_LABELS[service], on);
    await services.refetch();
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader
        title="Services"
        subtitle="Which services run in this zone. Switching one off stops new onboarding and new orders for it here."
      />
      <CardBody>
        {services.isError ? (
          <CardError what="The services" onRetry={() => void services.refetch()} />
        ) : !services.data ? (
          <CardSkeleton rows={3} />
        ) : (
          <ul className="divide-y divide-line">
            {services.data.services.map((s) => {
              const Icon = ICON[s.service];
              return (
                <li
                  key={s.service}
                  className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {s.label}
                      {s.isDefault ? <Badge>Default</Badge> : null}
                      <Badge tone={s.enabled ? 'success' : 'neutral'} dot>
                        {s.enabled ? 'On' : 'Off'}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.updatedBy && s.updatedAt
                        ? `Changed by ${s.updatedBy.name}, ${formatTimestamp(s.updatedAt)}`
                        : 'Never changed: the platform default applies'}
                    </p>
                  </div>
                  <Switch
                    checked={s.enabled}
                    disabled={busy}
                    label={`${s.label} in ${zone.name}`}
                    onChange={(next) => (next ? void run(s.service, true) : setConfirm(s.service))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      <ServiceSwitchConfirm
        pending={confirm ? { zoneName: zone.name, label: ZONE_SERVICE_LABELS[confirm] } : null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void run(c, false);
        }}
      />
      {dialog}
    </Card>
  );
}
