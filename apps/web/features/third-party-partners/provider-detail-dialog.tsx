'use client';

import { Edit, Power, PowerOff } from 'lucide-react';
import type { ThirdPartyProvider } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { formatRupees } from '../../lib/format';

/**
 * Profile dialog for a third-party provider. Doc 09 documents no
 * `GET /third-party-providers/{id}`, so this renders the list row, exactly like
 * the M10 partner profile dialog.
 *
 * Coverage is a list of zone chips (many-to-many, doc 36), and the integration
 * flag is shown as a configuration state only — never as a live connection
 * (task constraint: do not claim an integration is operational).
 */
export type ProviderDetailAction = 'edit' | 'toggle-status';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

const INTEGRATION_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'Not configured',
  CONFIGURED: 'Configured',
};

const SETTLEMENT_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PARTIAL: 'Partially settled',
  SETTLED: 'Settled',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-medium text-text">{value}</span>
    </div>
  );
}

export function ProviderDetailDialog({
  provider,
  onAction,
  onClose,
}: {
  provider: ThirdPartyProvider;
  onAction: (provider: ThirdPartyProvider, action: ProviderDetailAction) => void;
  onClose: () => void;
}) {
  const canDisable = provider.status === 'ACTIVE';
  const canEnable = provider.status === 'INACTIVE';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{provider.name}</DialogTitle>
          <DialogDescription>
            {provider.providerType} · {provider.contactPerson}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Service zones</p>
            <div className="flex flex-wrap gap-1.5">
              {provider.zones.length === 0 ? (
                <span className="text-sm text-muted">No zones covered</span>
              ) : (
                provider.zones.map((zone) => <Badge key={zone.id}>{zone.name}</Badge>)
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 px-3 py-1">
            <Row label="Status" value={STATUS_LABELS[provider.status] ?? provider.status} />
            <Row
              label="Integration"
              value={INTEGRATION_LABELS[provider.integrationStatus] ?? provider.integrationStatus}
            />
            <Row
              label="Settlement"
              value={SETTLEMENT_LABELS[provider.settlementStatus] ?? provider.settlementStatus}
            />
            <Row label="Contact email" value={provider.contactEmail} />
            <Row label="Contact phone" value={provider.contactPhone} />
          </div>

          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 px-3 py-1">
            <Row label="Deliveries" value={String(provider.deliveriesCount)} />
            <Row label="Successful" value={String(provider.successfulDeliveries)} />
            <Row label="Failed" value={String(provider.failedDeliveries)} />
            <Row
              label="Average delivery time"
              value={
                provider.avgDeliveryMinutes === null ? '—' : `${provider.avgDeliveryMinutes} min`
              }
            />
            <Row label="Provider cost" value={formatRupees(provider.providerCostPaise)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onAction(provider, 'edit')}>
            <Edit className="size-4" /> Edit
          </Button>
          {canDisable ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => onAction(provider, 'toggle-status')}
            >
              <PowerOff className="size-4" /> Disable
            </Button>
          ) : canEnable ? (
            <Button type="button" onClick={() => onAction(provider, 'toggle-status')}>
              <Power className="size-4" /> Enable
            </Button>
          ) : (
            <Button type="button" disabled title="Suspended providers must be re-activated first">
              <Power className="size-4" /> Enable
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
