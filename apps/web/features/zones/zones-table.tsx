'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
} from 'lucide-react';
import type { Zone } from '@zoauro/shared';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';

export type RowAction = 'edit' | 'deactivate' | 'activate';

const STATUS_LABELS: Record<Zone['status'], string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  UPCOMING: 'Upcoming',
};

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
    <TableHead className={className}>
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

/** Columns per doc 20 Zone Management + Figma. "—" = source tables pending F1.1. */
export function ZonesTable({
  zones,
  sort,
  onSort,
  onAction,
}: {
  zones: Zone[];
  sort: string;
  onSort: (next: string) => void;
  onAction: (zone: Zone, action: RowAction) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10">#</TableHead>
          <SortHeader field="name" label="Zone Name" sort={sort} onSort={onSort} />
          <SortHeader field="city" label="City" sort={sort} onSort={onSort} />
          <TableHead>State</TableHead>
          <TableHead>Zonal Admin</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Restaurants</TableHead>
          <TableHead className="text-right">Homemakers</TableHead>
          <TableHead className="text-right">Delivery Partners</TableHead>
          <TableHead className="text-right">Customers</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {zones.map((zone, index) => (
          <TableRow key={zone.id}>
            <TableCell className="text-muted">{index + 1}</TableCell>
            <TableCell>
              <span className="flex items-center gap-2 font-medium text-text">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: zone.colorHex }}
                  aria-hidden
                />
                {zone.name}
                <span className="font-normal text-muted">{zone.code}</span>
              </span>
            </TableCell>
            <TableCell>{zone.city}</TableCell>
            <TableCell>{zone.state}</TableCell>
            <TableCell className="text-muted" title="Zone team data arrives with F1.1">
              —
            </TableCell>
            <TableCell>
              <Badge tone={statusTone(zone.status)}>{STATUS_LABELS[zone.status]}</Badge>
            </TableCell>
            <TableCell
              className="text-right text-muted"
              title="Operational counts arrive with F1.1"
            >
              —
            </TableCell>
            <TableCell
              className="text-right text-muted"
              title="Operational counts arrive with F1.1"
            >
              —
            </TableCell>
            <TableCell
              className="text-right text-muted"
              title="Operational counts arrive with F1.1"
            >
              —
            </TableCell>
            <TableCell
              className="text-right text-muted"
              title="Operational counts arrive with F1.1"
            >
              —
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${zone.name}`}
                  onClick={() => onAction(zone, 'edit')}
                >
                  <Pencil className="size-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`More actions for ${zone.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onAction(zone, 'edit')}>
                      <Pencil className="size-4" /> Edit zone
                    </DropdownMenuItem>
                    {zone.status !== 'INACTIVE' ? (
                      <DropdownMenuItem
                        onSelect={() => onAction(zone, 'deactivate')}
                        className="text-danger"
                      >
                        <PowerOff className="size-4" /> Deactivate
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => onAction(zone, 'activate')}>
                        <Power className="size-4" /> Activate
                      </DropdownMenuItem>
                    )}
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
