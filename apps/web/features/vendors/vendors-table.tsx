'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  ChevronLeft,
  ChevronRight,
  Eye,
  MoreVertical,
  Pencil,
  Power,
  PowerOff,
  ShieldCheck,
  ShieldX,
  Trash2,
} from 'lucide-react';
import type { Vendor } from '@zoauro/shared';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';

export type VendorRowAction =
  'view' | 'edit' | 'verify' | 'reject' | 'activate' | 'deactivate' | 'suspend' | 'delete';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

const VERIFICATION_LABELS: Record<string, string> = {
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

const AVATAR_TONES = [
  'bg-[#ff5a1f]',
  'bg-[#f59e0b]',
  'bg-[#2f6bff]',
  'bg-[#16a34a]',
  'bg-[#7c3aed]',
  'bg-[#dc2626]',
];

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Deterministic avatar colour per record (Figma: solid circle + initial). */
function avatarTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? 'bg-[#ff5a1f]';
}

function SortHeader({
  field,
  label,
  sort,
  onSort,
  className,
}: {
  field: string;
  label: string;
  sort: string;
  onSort: (next: string) => void;
  className?: string;
}) {
  const active = sort === field || sort === `-${field}`;
  const desc = sort === `-${field}`;
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <TableHead className={cn('text-text', className)}>
      <button
        type="button"
        onClick={() => onSort(active && !desc ? `-${field}` : field)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-text',
          active && 'text-text',
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

function tagLine(vendor: Vendor): string {
  const tags = vendor.kind === 'restaurant' ? vendor.cuisineTags : vendor.specialityTags;
  if (tags.length === 0) return '—';
  const shown = tags.slice(0, 2).join(', ');
  return tags.length > 2 ? `${shown} +${tags.length - 2}` : shown;
}

function verificationTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'VERIFIED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING') return 'warning';
  return 'neutral';
}

/**
 * Vendor list table (doc 20: Verification and Status as separate columns;
 * doc 18 tabs decide which kind is rendered; Figma frame 133854: avatar +
 * owner + registered date, kebab-only actions).
 * `showZoneChip` follows doc 19/37: the zone chip appears when the scope
 * covers more than one zone.
 */
export function VendorsTable({
  vendors,
  sort,
  onSort,
  onAction,
  showZoneChip,
}: {
  vendors: Vendor[];
  sort: string;
  onSort: (next: string) => void;
  onAction: (vendor: Vendor, action: VendorRowAction) => void;
  showZoneChip: boolean;
}) {
  const isRestaurant = vendors[0]?.kind !== 'homemaker';

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 text-text">#</TableHead>
          <SortHeader
            field="name"
            label={isRestaurant ? 'Restaurant name' : 'Homemaker name'}
            sort={sort}
            onSort={onSort}
          />
          {isRestaurant && <TableHead className="text-text">Owner</TableHead>}
          <TableHead className="text-text">Zone</TableHead>
          <SortHeader field="area" label="Area" sort={sort} onSort={onSort} />
          <TableHead className="text-text">Cuisine</TableHead>
          <TableHead className="text-center text-text">Verification</TableHead>
          <TableHead className="text-center text-text">Status</TableHead>
          <SortHeader field="createdAt" label="Registered date" sort={sort} onSort={onSort} />
          <TableHead className="text-right text-text">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vendors.map((vendor) => (
          <TableRow key={vendor.id} className="even:bg-[#f9fafb]">
            <TableCell className="text-muted">#{vendor.id.slice(0, 4).toUpperCase()}</TableCell>
            <TableCell>
              <span className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white',
                    avatarTone(vendor.id),
                  )}
                  aria-hidden="true"
                >
                  {vendor.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="font-semibold text-text">{vendor.name}</span>
              </span>
            </TableCell>
            {isRestaurant && (
              <TableCell className="text-muted">
                {vendor.kind === 'restaurant' ? vendor.ownerName : '—'}
              </TableCell>
            )}
            <TableCell>
              {showZoneChip ? (
                <Badge>{vendor.zone.name}</Badge>
              ) : (
                <span className="text-muted">{vendor.zone.name}</span>
              )}
            </TableCell>
            <TableCell className="text-muted">{vendor.area ?? '—'}</TableCell>
            <TableCell className="text-muted">{tagLine(vendor)}</TableCell>
            <TableCell className="text-center">
              <Badge tone={verificationTone(vendor.verificationStatus)}>
                {VERIFICATION_LABELS[vendor.verificationStatus]}
              </Badge>
            </TableCell>
            <TableCell className="text-center">
              <Badge tone={statusTone(vendor.status)}>{STATUS_LABELS[vendor.status]}</Badge>
            </TableCell>
            <TableCell className="text-muted">
              {new Date(vendor.createdAt).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`More actions for ${vendor.name}`}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onAction(vendor, 'view')}>
                      <Eye className="size-4" /> View details
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onAction(vendor, 'edit')}>
                      <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    {vendor.verificationStatus === 'PENDING' && (
                      <>
                        <DropdownMenuItem onSelect={() => onAction(vendor, 'verify')}>
                          <ShieldCheck className="size-4" /> Verify
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onAction(vendor, 'reject')}
                          className="text-danger"
                        >
                          <ShieldX className="size-4" /> Reject
                        </DropdownMenuItem>
                      </>
                    )}
                    {vendor.status === 'ACTIVE' ? (
                      <>
                        <DropdownMenuItem onSelect={() => onAction(vendor, 'deactivate')}>
                          <PowerOff className="size-4" /> Deactivate
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction(vendor, 'suspend')}>
                          <Ban className="size-4" /> Suspend
                        </DropdownMenuItem>
                      </>
                    ) : (
                      vendor.verificationStatus === 'VERIFIED' && (
                        <DropdownMenuItem onSelect={() => onAction(vendor, 'activate')}>
                          <Power className="size-4" /> Activate
                        </DropdownMenuItem>
                      )
                    )}
                    <DropdownMenuItem
                      onSelect={() => onAction(vendor, 'delete')}
                      className="text-danger"
                    >
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function VendorsPagination({
  page,
  pageSize,
  total,
  noun,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: 'restaurants' | 'homemakers';
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p += 1) pages.push(p);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-sm text-muted">
        Showing {first}-{last} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {start > 1 && <span className="px-1 text-sm text-muted">…</span>}
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              'h-8 min-w-8 rounded-md px-2 text-sm',
              p === page
                ? 'bg-nav-active font-medium text-white'
                : 'text-muted hover:bg-bg hover:text-text',
            )}
          >
            {p}
          </button>
        ))}
        {end < totalPages && <span className="px-1 text-sm text-muted">…</span>}
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
        <SelectTrigger className="h-8 w-24" aria-label="Rows per page">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size} / page
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
