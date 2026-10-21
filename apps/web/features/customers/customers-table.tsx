'use client';

import { Edit, Eye, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Customer } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatDate, formatRupees } from '../../lib/format';
import { cn } from '../../lib/cn';

export type CustomerRowAction = 'view' | 'edit' | 'block' | 'unblock';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
};

/** Real-record status → pill colours, local to this table (TD-24 pattern —
 *  the shared `statusTone` in badge.tsx stays untouched). The red/amber
 *  mapping for INACTIVE/BLOCKED follows the reference frame (134044). */
const STATUS_PILLS: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-red-50 text-red-700',
  BLOCKED: 'bg-amber-100 text-amber-700',
};

const SOURCE_LABELS: Record<string, string> = {
  APP: 'App',
  ADMIN: 'Admin',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};

/** Figma "Registration Source" column (doc 37 item 11). */
const SOURCE_PILLS: Record<string, string> = {
  APP: 'bg-blue-50 text-blue-700',
  ADMIN: 'bg-orange-50 text-orange-700',
  REFERRAL: 'bg-amber-100 text-amber-700',
  OTHER: 'bg-slate-100 text-slate-600',
};

function Pill({
  labels,
  pills,
  value,
}: {
  labels: Record<string, string>;
  pills: Record<string, string>;
  value: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
        pills[value] ?? 'bg-slate-100 text-slate-600',
      )}
    >
      {labels[value] ?? value}
    </span>
  );
}

/** Compact uppercase header cell (reference frame 134044 — overrides the
 *  shared TableHead token styling for this table only). */
function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TableHead
      className={cn(
        'h-9 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

function TooltipIcon({
  title,
  children,
  onClick,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-md hover:bg-orange-50 hover:text-orange-600 transition-colors"
      title={title}
    >
      {children}
    </button>
  );
}

/** Block is destructive (confirm in the screen); unblock restores ACTIVE. */
function BlockToggle({ customer, onAction }: { customer: Customer; onAction: () => void }) {
  const blocked = customer.status === 'BLOCKED';
  return (
    <button
      type="button"
      onClick={onAction}
      className={cn(
        'flex size-9 items-center justify-center rounded-md text-[11px] font-semibold transition-colors',
        blocked
          ? 'bg-green-100 text-green-800 hover:bg-green-200'
          : 'bg-red-50 text-red-700 hover:bg-red-100',
      )}
      title={blocked ? 'Unblock' : 'Block'}
    >
      {blocked ? 'ON' : 'OFF'}
    </button>
  );
}

/** Deterministic avatar chip: initials + a tone derived from the name so the
 *  same customer always gets the same colour without storing anything. */
const AVATAR_TONES = [
  'bg-orange-100 text-orange-700',
  'bg-blue-50 text-blue-700',
  'bg-emerald-50 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-50 text-rose-700',
];

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.charAt(0) ?? '';
  const lastWord = words[words.length - 1];
  const last = words.length > 1 ? (lastWord?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

function avatarTone(name: string): string {
  const code = name.charCodeAt(0) + name.length;
  return AVATAR_TONES[code % AVATAR_TONES.length] ?? 'bg-orange-100 text-orange-700';
}

function CustomerCells({
  customer,
  showZoneChip,
  onAction,
}: {
  customer: Customer;
  showZoneChip: boolean;
  onAction: (customer: Customer, action: CustomerRowAction) => void;
}) {
  const primaryZone = customer.zones[0];
  return (
    <>
      <TableCell>
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
              avatarTone(customer.name),
            )}
          >
            {initialsOf(customer.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-slate-900">
              {customer.name}
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              CUS-{customer.id.slice(0, 4).toUpperCase()}
            </span>
          </span>
        </span>
      </TableCell>
      <TableCell>
        <span className="block text-[13px] font-medium text-slate-900">
          {customer.email ?? customer.phone}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          {customer.email ? customer.phone : '—'}
        </span>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="text-[13px] text-text">
            {primaryZone ? (
              showZoneChip ? (
                <Badge>{primaryZone.name}</Badge>
              ) : (
                primaryZone.name
              )
            ) : (
              '—'
            )}
          </span>
        </span>
        {customer.zones.length > 1 && (
          <span className="mt-0.5 block text-[11px] text-slate-400">
            +{customer.zones.length - 1} more zone{customer.zones.length > 2 ? 's' : ''}
          </span>
        )}
      </TableCell>
      <TableCell className="text-[13px] text-slate-600">{customer.orderCount}</TableCell>
      <TableCell className="text-[13px] font-medium text-slate-900">
        {formatRupees(customer.totalSpentPaise)}
      </TableCell>
      <TableCell>
        <Pill labels={SOURCE_LABELS} pills={SOURCE_PILLS} value={customer.source} />
      </TableCell>
      <TableCell>
        <Pill labels={STATUS_LABELS} pills={STATUS_PILLS} value={customer.status} />
      </TableCell>
      <TableCell className="text-[12px] text-slate-500">{formatDate(customer.createdAt)}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-4">
          <TooltipIcon title="View" onClick={() => onAction(customer, 'view')}>
            <Eye className="size-4" />
          </TooltipIcon>
          <TooltipIcon title="Edit" onClick={() => onAction(customer, 'edit')}>
            <Edit className="size-4" />
          </TooltipIcon>
          <BlockToggle
            customer={customer}
            onAction={() => onAction(customer, customer.status === 'BLOCKED' ? 'unblock' : 'block')}
          />
        </div>
      </TableCell>
    </>
  );
}

/**
 * Customers table (doc 20 Customers list, doc 34 SA-3.1): name, masked
 * contact (D26 — the API masks, this table only renders), zones, scope-filtered
 * orders and spend (D25), registration source, status and the View / Edit /
 * Block actions. Block is confirmed in the screen because it stops ordering.
 */
export function CustomersTable({
  customers,
  onAction,
  showZoneChip,
}: {
  customers: Customer[];
  onAction: (customer: Customer, action: CustomerRowAction) => void;
  showZoneChip: boolean;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Customer</Th>
          <Th>Contact</Th>
          <Th>Zones</Th>
          <Th>Orders</Th>
          <Th>Total spent</Th>
          <Th>Source</Th>
          <Th>Status</Th>
          <Th>Joined</Th>
          <Th className="text-right">Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id} className="h-[64px] border-b border-slate-200">
            <CustomerCells customer={customer} showZoneChip={showZoneChip} onAction={onAction} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
