'use client';

import { Edit, Eye, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DeliveryPartner } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatRupees } from '../../lib/format';
import { cn } from '../../lib/cn';

export type PartnerRowAction = 'view' | 'edit' | 'force-offline';

const STATUS_LABELS: Record<string, string> = {
  PENDING_VERIFICATION: 'Pending',
  VERIFIED: 'Verified',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

/** Real-record status → pill colours, local to this table (TD-24 pattern —
 *  the shared `statusTone` in badge.tsx stays untouched). */
const STATUS_PILLS: Record<string, string> = {
  PENDING_VERIFICATION: 'bg-amber-100 text-amber-700',
  VERIFIED: 'bg-blue-50 text-blue-700',
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  SUSPENDED: 'bg-red-50 text-red-700',
};

const SETTLEMENT_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PARTIAL: 'Partly settled',
  SETTLED: 'Settled',
};

const SETTLEMENT_PILLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  PARTIAL: 'bg-blue-50 text-blue-700',
  SETTLED: 'bg-green-50 text-green-700',
};

/** Settlement is its own axis (task spec: a "Settlement" column). */
export function SettlementPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
        SETTLEMENT_PILLS[status] ?? 'bg-slate-100 text-slate-600',
      )}
    >
      {SETTLEMENT_LABELS[status] ?? status}
    </span>
  );
}

/** Availability is separate from status (doc 10 §5: the online flag). */
export function DutyPill({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
        isOnline ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600',
      )}
    >
      {isOnline ? 'On duty' : 'Off duty'}
    </span>
  );
}

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

/** Header cell per the Figma reference: 13px medium slate-600 (overrides the
 *  shared TableHead token styling for this table only). */
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

function PartnerCells({
  partner,
  showZoneChip,
  onAction,
}: {
  partner: DeliveryPartner;
  showZoneChip: boolean;
  onAction: (partner: DeliveryPartner, action: PartnerRowAction) => void;
}) {
  return (
    <>
      <TableCell>
        <span className="block text-[14px] font-semibold text-slate-900">{partner.name}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          PTR-{partner.id.slice(0, 4).toUpperCase()}
        </span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-text">{partner.phone}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{partner.vehicleNo ?? '—'}</span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-text">
          {showZoneChip ? <Badge>{partner.zone.name}</Badge> : partner.zone.name}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{partner.area ?? '—'}</span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-text">{partner.vehicleType}</span>
      </TableCell>
      <TableCell>
        <DutyPill isOnline={partner.isOnline} />
      </TableCell>
      <TableCell>
        <span className="block text-[13px] font-medium text-slate-900">
          {partner.ordersAssigned}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">orders assigned</span>
      </TableCell>
      <TableCell className="text-[13px] text-text">{partner.deliveriesCount}</TableCell>
      <TableCell>
        <span className="block text-[13px] font-medium text-slate-900">
          {partner.failedDeliveries}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          {partner.failedDeliveries === 1 ? 'failure' : 'failures'}
        </span>
      </TableCell>
      <TableCell className="text-[13px] text-text">
        {partner.avgDeliveryMinutes === null ? '—' : `${partner.avgDeliveryMinutes} min`}
      </TableCell>
      <TableCell className="text-[13px] text-text">
        {partner.onTimePct === null ? '—' : `${partner.onTimePct}%`}
      </TableCell>
      <TableCell>
        <span className="block text-[13px] font-medium text-slate-900">
          {partner.ratingAvg === null ? '—' : `${partner.ratingAvg.toFixed(1)} ★`}
        </span>
      </TableCell>
      <TableCell className="text-[13px] font-medium text-slate-900">
        {formatRupees(partner.earningsPaise)}
      </TableCell>
      <TableCell>
        <SettlementPill status={partner.settlementStatus} />
      </TableCell>
      <TableCell>
        <StatusPill status={partner.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-4">
          <TooltipIcon title="View" onClick={() => onAction(partner, 'view')}>
            <Eye className="size-4" />
          </TooltipIcon>
          <TooltipIcon title="Edit" onClick={() => onAction(partner, 'edit')}>
            <Edit className="size-4" />
          </TooltipIcon>
          <TooltipIcon
            title={partner.isOnline ? 'Force offline' : 'Already off duty'}
            onClick={() => onAction(partner, 'force-offline')}
            className={
              partner.isOnline
                ? 'hover:bg-red-50 hover:text-red-700'
                : 'cursor-not-allowed opacity-40'
            }
          >
            <WifiOff className="size-4" />
          </TooltipIcon>
        </div>
      </TableCell>
    </>
  );
}

/**
 * Own Delivery Partners table (task spec; doc 20 list, doc 34 SA-3.2): masked
 * contact (D26), zone/area, vehicle, the on-duty flag (separate from status,
 * doc 10 §5), then the performance columns the task requires — orders, delivered,
 * failed/delayed, avg time, on-time %, rating, earnings and settlement.
 * Performance values are seed data until the M11 orders pipeline maintains them
 * (see the handoff gap). Verification actions live in the profile dialog opened
 * by View, like the vendors table; force offline stays a one-click row action
 * because it is the operational lever (doc 09).
 */
export function DeliveryPartnersTable({
  partners,
  onAction,
  showZoneChip,
}: {
  partners: DeliveryPartner[];
  onAction: (partner: DeliveryPartner, action: PartnerRowAction) => void;
  showZoneChip: boolean;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Partner</Th>
          <Th>Contact</Th>
          <Th>Zone / area</Th>
          <Th>Vehicle</Th>
          <Th>Availability</Th>
          <Th>Orders</Th>
          <Th>Delivered</Th>
          <Th>Failed / delayed</Th>
          <Th>Avg time</Th>
          <Th>On-time</Th>
          <Th>Rating</Th>
          <Th>Earnings</Th>
          <Th>Settlement</Th>
          <Th>Status</Th>
          <Th className="text-right">Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {partners.map((partner) => (
          <TableRow key={partner.id} className="h-[72px] border-b border-slate-200">
            <PartnerCells partner={partner} showZoneChip={showZoneChip} onAction={onAction} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
