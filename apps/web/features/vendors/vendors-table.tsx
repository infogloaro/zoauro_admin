'use client';

import { Eye, Edit } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Vendor, VendorKind } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';
import type { ReferenceRow } from './demo-data';

export type VendorRowAction =
  'view' | 'edit' | 'verify' | 'reject' | 'activate' | 'deactivate' | 'suspend' | 'delete';
export type DemoRowAction = 'view' | 'edit' | 'deactivate' | 'activate';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

/** Real-record status → pill colors (Figma reference table): green / gray /
 * amber / red on tinted backgrounds, local to this table (TD-24 pattern —
 * the shared `statusTone` in badge.tsx is untouched). */
const STATUS_PILLS: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-red-50 text-red-700',
};

function StatusPill({ status }: { status: string }) {
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
 * shared TableHead token styling for this table only). */
function Th({ children }: { children: ReactNode }) {
  return <TableHead className="text-[13px] font-medium text-slate-600">{children}</TableHead>;
}

function idPrefix(kind: VendorKind): string {
  return kind === 'restaurant' ? 'RST' : 'HFP';
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
        'flex size-9 items-center justify-center rounded-md hover:bg-orange-50 hover:text-orange-600 transition-colors',
        className,
      )}
      title={title}
    >
      {children}
    </button>
  );
}

function ToggleStatus({ isActive, onToggle }: { isActive: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex size-9 items-center justify-center rounded-md hover:bg-orange-50 hover:text-orange-600 transition-colors',
        isActive
          ? 'bg-green-100 text-green-800 font-medium'
          : 'bg-slate-100 text-slate-600 font-medium',
      )}
      title={isActive ? 'Deactivate' : 'Activate'}
    >
      {isActive ? 'ON' : 'OFF'}
    </button>
  );
}

function ReferenceCells({
  row,
  onDemoAction,
}: {
  row: ReferenceRow;
  onDemoAction: (action: DemoRowAction, row?: ReferenceRow) => void;
}) {
  return (
    <>
      <TableCell>
        <span className="block text-[14px] font-semibold text-slate-900">{row.name}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{row.id}</span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-text">{row.ownerName}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{row.phone}</span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-text">{row.zone}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{row.admin}</span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-slate-700">{row.orders}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">completed orders</span>
      </TableCell>
      <TableCell className="text-[13px] text-slate-700">{row.gross}</TableCell>
      <TableCell className="text-[13px] text-slate-700">{row.commission}</TableCell>
      <TableCell className="text-[13px] text-slate-700">{row.refunds}</TableCell>
      <TableCell className="text-[13px] text-slate-700">{row.payout}</TableCell>
      <TableCell>
        <StatusPill status={row.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <TooltipIcon title="View" onClick={() => onDemoAction('view', row)}>
            <Eye className="size-4" />
          </TooltipIcon>
          <TooltipIcon title="Edit" onClick={() => onDemoAction('edit', row)}>
            <Edit className="size-4" />
          </TooltipIcon>
          <ToggleStatus
            isActive={row.status === 'ACTIVE'}
            onToggle={() => onDemoAction(row.status === 'ACTIVE' ? 'deactivate' : 'activate', row)}
          />
        </div>
      </TableCell>
    </>
  );
}

function VendorCells({
  vendor,
  kind,
  showZoneChip,
  onAction,
}: {
  vendor: Vendor;
  kind: VendorKind;
  showZoneChip: boolean;
  onAction: (vendor: Vendor, action: VendorRowAction) => void;
}) {
  const ownerName = vendor.kind === 'restaurant' ? vendor.ownerName : null;
  return (
    <>
      <TableCell>
        <span className="block text-[14px] font-semibold text-slate-900">{vendor.name}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          {idPrefix(kind)}-{vendor.id.slice(0, 4).toUpperCase()}
        </span>
      </TableCell>
      <TableCell>
        {ownerName && <span className="block text-[13px] text-text">{ownerName}</span>}
        <span className={cn('block text-[11px] text-slate-400', ownerName && 'mt-0.5')}>
          {vendor.phone}
        </span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] text-text">
          {showZoneChip ? <Badge>{vendor.zone.name}</Badge> : vendor.zone.name}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">—</span>
      </TableCell>
      <TableCell className="text-[13px] text-slate-400">—</TableCell>
      <TableCell className="text-[13px] text-slate-400">—</TableCell>
      <TableCell className="text-[13px] text-slate-400">—</TableCell>
      <TableCell className="text-[13px] text-slate-400">—</TableCell>
      <TableCell className="text-[13px] text-slate-400">—</TableCell>
      <TableCell>
        <StatusPill status={vendor.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-4">
          <TooltipIcon title="View" onClick={() => onAction(vendor, 'view')}>
            <Eye className="size-4" />
          </TooltipIcon>
          <TooltipIcon title="Edit" onClick={() => onAction(vendor, 'edit')}>
            <Edit className="size-4" />
          </TooltipIcon>
          <ToggleStatus
            isActive={vendor.status === 'ACTIVE'}
            onToggle={() =>
              onAction(vendor, vendor.status === 'ACTIVE' ? 'deactivate' : 'activate')
            }
          />
        </div>
      </TableCell>
    </>
  );
}

/**
 * Vendor records table (Figma frame "Restaurant records"): reference demo
 * rows pinned above the real records. Real rows use plain View / Edit /
 * Deactivate-Activate links (Figma action column — the old kebab menu is
 * gone; verify/reject/suspend/delete live in the detail dialog opened by
 * View). Financial columns have no backend yet — reference rows carry the
 * simulated values, real rows show "—".
 */
export function VendorsTable({
  kind,
  referenceRows,
  vendors,
  onAction,
  onDemoAction,
  showZoneChip,
}: {
  kind: VendorKind;
  referenceRows: ReferenceRow[];
  vendors: Vendor[];
  onAction: (vendor: Vendor, action: VendorRowAction) => void;
  onDemoAction: (action: DemoRowAction, row?: ReferenceRow) => void;
  showZoneChip: boolean;
}) {
  const isRestaurant = kind === 'restaurant';

  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>{isRestaurant ? 'Restaurant' : 'Provider'}</Th>
          <Th>Owner & contact</Th>
          <Th>Zone / admin</Th>
          <Th>Orders</Th>
          <Th>Gross value</Th>
          <Th>Commission</Th>
          <Th>Refunds</Th>
          <Th>Payout</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {referenceRows.map((row) => (
          <TableRow key={row.id} className="h-[72px] border-b border-slate-200">
            <ReferenceCells row={row} onDemoAction={onDemoAction} />
            <TableCell />
          </TableRow>
        ))}
        {vendors.map((vendor) => (
          <TableRow key={vendor.id} className="h-[72px] border-b border-slate-200">
            <VendorCells
              vendor={vendor}
              kind={kind}
              showZoneChip={showZoneChip}
              onAction={onAction}
            />
            <TableCell />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
