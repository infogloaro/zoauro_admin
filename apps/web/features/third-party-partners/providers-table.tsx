'use client';

import { Edit, Eye, Power, PowerOff } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThirdPartyProvider } from '@zoauro/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';

function shortId(id: string): string {
  return `3PL-${id.slice(0, 4).toUpperCase()}`;
}

export type ProviderRowAction = 'view' | 'edit' | 'toggle-status';

/** Settlement status → pill colours (reference frame's Settlement column). */
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PARTIAL: 'Partially settled',
  SETTLED: 'Settled',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

const STATUS_PILLS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  PARTIAL: 'bg-orange-50 text-orange-700',
  SETTLED: 'bg-green-50 text-green-700',
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  SUSPENDED: 'bg-red-50 text-red-700',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
        STATUS_PILLS[status] ?? 'bg-slate-100 text-slate-600',
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Header cell per the Figma reference: 13px medium slate-600. */
function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TableHead className={cn('text-[13px] font-medium text-slate-600', className)}>
      {children}
    </TableHead>
  );
}

function TooltipIcon({
  title,
  children,
  onClick,
  className,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-md transition-colors',
        className ?? 'hover:bg-orange-50 hover:text-orange-600',
      )}
      title={title}
    >
      {children}
    </button>
  );
}

/** Reference frame: a company cell with an id/prefix line under the name. */
function formatCompactPaise(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100_00_000) return `₹${(rupees / 100_00_000).toFixed(1)}L`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/**
 * Third-party providers table (reference frame Third-party.png). A provider is
 * a company, so the first column shows the company name and a prefix line; the
 * contract cell shows coverage count plus a contract-end line (the frame's
 * "3 zones / Active until Dec 2026"); the money column shows the per-delivery
 * or percentage fee model and the total fees paid for the settlement period.
 * Metrics are the sums the KPI cards read, so the two never disagree.
 */
export function ThirdPartyProvidersTable({
  providers,
  onAction,
  showZoneChip,
}: {
  providers: ThirdPartyProvider[];
  onAction: (provider: ThirdPartyProvider, action: ProviderRowAction) => void;
  showZoneChip: boolean;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Company</Th>
          <Th>Contract / zones</Th>
          <Th>Orders</Th>
          <Th>Delivered</Th>
          <Th>Failed / delayed</Th>
          <Th>Avg. time</Th>
          <Th>On-time</Th>
          <Th>Fee model</Th>
          <Th>Fees paid</Th>
          <Th>Settlement</Th>
          <Th className="text-right">Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {providers.map((provider) => {
          const onTimePct = formatPct(provider.successfulDeliveries, provider.deliveriesCount);
          const feeModel =
            provider.providerType === 'API'
              ? '₹42 / delivery'
              : provider.providerType === 'Webhook'
                ? '8% fee'
                : 'Manual';
          const canDisable = provider.status === 'ACTIVE';
          const canEnable = provider.status === 'INACTIVE';
          return (
            <TableRow key={provider.id} className="h-[72px] border-b border-slate-200">
              <TableCell>
                <span className="block text-[14px] font-semibold text-slate-900">
                  {provider.name}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {shortId(provider.id)} · {provider.providerType}
                </span>
              </TableCell>
              <TableCell>
                <span className="block text-[13px] text-text">
                  {provider.zones.length === 0
                    ? '—'
                    : `${provider.zones.length} ${provider.zones.length === 1 ? 'zone' : 'zones'}`}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {showZoneChip
                    ? provider.zones.map((zone) => zone.name).join(', ')
                    : `Contract · ${provider.settlementStatus.toLowerCase()} settlement`}
                </span>
              </TableCell>
              <TableCell className="text-[13px] font-medium text-slate-900">
                {provider.deliveriesCount}
              </TableCell>
              <TableCell className="text-[13px] text-text">
                {provider.successfulDeliveries}
              </TableCell>
              <TableCell className="text-[13px] text-text">{provider.failedDeliveries}</TableCell>
              <TableCell className="text-[13px] text-text">
                {provider.avgDeliveryMinutes === null ? '—' : `${provider.avgDeliveryMinutes} min`}
              </TableCell>
              <TableCell className="text-[13px] font-medium text-slate-900">{onTimePct}</TableCell>
              <TableCell className="text-[13px] text-text">{feeModel}</TableCell>
              <TableCell className="text-[13px] font-medium text-slate-900">
                {formatCompactPaise(provider.providerCostPaise)}
              </TableCell>
              <TableCell>
                <StatusPill status={provider.settlementStatus} />
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-4">
                  <TooltipIcon title="View" onClick={() => onAction(provider, 'view')}>
                    <Eye className="size-4" />
                  </TooltipIcon>
                  <TooltipIcon title="Edit" onClick={() => onAction(provider, 'edit')}>
                    <Edit className="size-4" />
                  </TooltipIcon>
                  {canDisable ? (
                    <TooltipIcon
                      title="Disable"
                      onClick={() => onAction(provider, 'toggle-status')}
                      className="hover:bg-red-50 hover:text-red-700"
                    >
                      <PowerOff className="size-4" />
                    </TooltipIcon>
                  ) : canEnable ? (
                    <TooltipIcon title="Enable" onClick={() => onAction(provider, 'toggle-status')}>
                      <Power className="size-4" />
                    </TooltipIcon>
                  ) : (
                    <TooltipIcon
                      title="Suspended providers must be re-activated first"
                      onClick={() => {}}
                      className="cursor-not-allowed opacity-40"
                    >
                      <Power className="size-4" />
                    </TooltipIcon>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
