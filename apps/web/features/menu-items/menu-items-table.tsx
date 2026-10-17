'use client';

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  DIETARY_LABELS,
  MENU_STATUS_LABELS,
  MENU_STATUS_TONES,
  type MenuItem,
} from '@zoauro/shared';
import { MoreVertical } from 'lucide-react';
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

export type MenuItemRowAction = 'view' | 'edit' | 'approve' | 'reject' | 'archive' | 'delete';

/**
 * Row actions the approval workflow (doc 10 §4) allows from each status:
 * Approve covers PENDING review, REJECTED re-review and ARCHIVED restore;
 * Reject only leaves PENDING; Archive leaves anything not yet archived.
 * Pure so the menu is testable and never offers an illegal transition.
 */
export function menuActionsFor(status: MenuItem['approvalStatus']): MenuItemRowAction[] {
  const actions: MenuItemRowAction[] = ['view', 'edit'];
  if (status === 'PENDING' || status === 'REJECTED' || status === 'ARCHIVED') {
    actions.push('approve');
  }
  if (status === 'PENDING') actions.push('reject');
  if (status !== 'ARCHIVED') actions.push('archive');
  actions.push('delete');
  return actions;
}

function Th({ children }: { children: ReactNode }) {
  return <TableHead className="text-[13px] font-medium text-slate-600">{children}</TableHead>;
}

function ActionMenu({
  item,
  onAction,
}: {
  item: MenuItem;
  onAction: (item: MenuItem, action: MenuItemRowAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    openUp: false,
  });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menuHeight = Math.min(280, window.innerHeight * 0.6);
    const menuWidth = 176;
    const gap = 8;
    const edge = 8;

    const spaceBelow = window.innerHeight - rect.bottom - gap - edge;
    const spaceAbove = rect.top - gap - edge;
    const openUp = spaceBelow < Math.min(menuHeight, 220) && spaceAbove > spaceBelow;

    const left = Math.max(
      edge,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - edge),
    );

    const top = openUp
      ? Math.max(edge, rect.top - gap - menuHeight)
      : Math.min(rect.bottom + gap, window.innerHeight - menuHeight - edge);

    setPosition({ top, left, openUp });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    updatePosition();

    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;

      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, updatePosition]);

  const runAction = (action: MenuItemRowAction) => {
    setOpen(false);
    onAction(item, action);
  };

  const menuItemClass =
    'block w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400';

  const labels: Record<MenuItemRowAction, string> = {
    view: 'View details',
    edit: 'Edit item',
    approve: 'Approve',
    reject: 'Reject',
    archive: 'Archive',
    delete: 'Delete',
  };

  const actions = menuActionsFor(item.approvalStatus);
  const groups: MenuItemRowAction[][] = [
    actions.filter((a) => a === 'view' || a === 'edit'),
    actions.filter((a) => a === 'approve' || a === 'reject'),
    actions.filter((a) => a === 'archive'),
    actions.filter((a) => a === 'delete'),
  ].filter((group) => group.length > 0);

  return (
    <>
      <div className="flex justify-end">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Actions for ${item.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            if (!open) updatePosition();
            setOpen((current) => !current);
          }}
          className="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <MoreVertical className="size-5" aria-hidden="true" />
        </button>
      </div>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${item.name}`}
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              width: 176,
              maxHeight: 'min(280px, 60vh)',
            }}
            className="z-[9999] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          >
            {groups.map((group, groupIndex) => (
              <div key={group[0]}>
                {groupIndex > 0 && <div className="my-1 border-t border-slate-100" />}
                {group.map((action) => (
                  <button
                    key={action}
                    type="button"
                    role="menuitem"
                    data-menu-action={action}
                    onClick={() => runAction(action)}
                    className={
                      action === 'approve'
                        ? `${menuItemClass} text-emerald-700 hover:bg-emerald-50`
                        : action === 'reject' || action === 'delete'
                          ? `${menuItemClass} text-red-600 hover:bg-red-50`
                          : menuItemClass
                    }
                  >
                    {labels[action]}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItemsTable({
  items,
  onAction,
  selectable = false,
  selectedIds,
  onToggle,
  onToggleAll,
  showZoneChip,
}: {
  items: MenuItem[];
  onAction: (item: MenuItem, action: MenuItemRowAction) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: (checked: boolean) => void;
  showZoneChip?: boolean;
}) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds?.has(item.id) ?? false);

  const someSelected = items.some((item) => selectedIds?.has(item.id) ?? false);

  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          {selectable && (
            <Th>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = !allSelected && someSelected;
                  }
                }}
                onChange={(event) => onToggleAll?.(event.target.checked)}
                className="size-4 accent-orange-500"
              />
            </Th>
          )}

          <Th>Food Item</Th>
          <Th>Hotel &amp; Menu</Th>
          <Th>Zone/Admin</Th>
          <Th>Price</Th>
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Updated</Th>
          <Th>Actions</Th>
        </TableRow>
      </TableHeader>

      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} className="h-[72px] border-b border-slate-200">
            {selectable && (
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`Select ${item.name}`}
                  checked={selectedIds?.has(item.id) ?? false}
                  onChange={() => onToggle?.(item.id)}
                  className="size-4 accent-orange-500"
                />
              </TableCell>
            )}

            <TableCell>
              <div className="flex min-w-0 items-center gap-3">
                {/* menu_items carries no image column (doc 08 reshape dropped
                    image_key), so every row shows the neutral placeholder. */}
                <div
                  role="img"
                  aria-label="No food image available"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-xl"
                >
                  🍽️
                </div>

                <div className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-slate-900">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {item.category ?? 'Uncategorised'}
                  </span>
                </div>
              </div>
            </TableCell>

            <TableCell>
              <span className="block text-[13px] text-text">{item.vendorName}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {item.vendorType === 'restaurant'
                  ? 'Restaurant'
                  : item.vendorType === 'homemaker'
                    ? 'Home food'
                    : 'Hotel'}
              </span>
            </TableCell>

            <TableCell>
              <span className="block text-[13px] text-text">
                {showZoneChip ? <Badge>{item.zone.name}</Badge> : item.zone.name}
              </span>
            </TableCell>

            <TableCell className="text-[13px] font-semibold text-slate-700">
              {formatRupees(item.price)}
            </TableCell>

            <TableCell>
              <Badge tone="info">{DIETARY_LABELS[item.dietary] ?? item.dietary}</Badge>
            </TableCell>

            <TableCell>
              <Badge tone={MENU_STATUS_TONES[item.approvalStatus]}>
                {MENU_STATUS_LABELS[item.approvalStatus] ?? item.approvalStatus}
              </Badge>
            </TableCell>

            <TableCell>
              <span className="text-[11px] text-slate-400">
                {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '—'}
              </span>
            </TableCell>

            <TableCell>
              <ActionMenu item={item} onAction={onAction} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
