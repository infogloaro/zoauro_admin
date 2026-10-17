'use client';

import {
  DIETARY_LABELS,
  MENU_STATUS_LABELS,
  MENU_STATUS_TONES,
  type MenuItem,
  type MenuOwnerKind,
} from '@zoauro/shared';
import { Pencil } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { formatDateTime, formatRupees } from '../../lib/format';

const OWNER_KIND_LABELS: Record<MenuOwnerKind, string> = {
  restaurant: 'Restaurant',
  homemaker: 'Home food',
  hotel: 'Hotel',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  );
}

/**
 * View overlay for one menu item (doc 20 detail pattern). Rendered by the
 * screen only once the fetched record matches the requested id, so a
 * previously selected item can never flash for a newly selected row.
 */
export function MenuItemDetailDialog({
  item,
  onEdit,
  onClose,
}: {
  item: MenuItem;
  onEdit?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            {item.description?.trim() || 'No description provided.'}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Badge tone={MENU_STATUS_TONES[item.approvalStatus]}>
              {MENU_STATUS_LABELS[item.approvalStatus] ?? item.approvalStatus}
            </Badge>
          </Field>
          <Field label="Price">{formatRupees(item.price)}</Field>
          <Field label="Category">{item.category?.trim() || 'Uncategorised'}</Field>
          <Field label="Dietary">
            <Badge tone="info">{DIETARY_LABELS[item.dietary] ?? item.dietary}</Badge>
          </Field>
          <Field label="Provider">
            <span className="block">{item.vendorName}</span>
            <span className="mt-0.5 block text-xs text-muted">
              {OWNER_KIND_LABELS[item.vendorType] ?? item.vendorType}
            </span>
          </Field>
          <Field label="Zone">
            <span className="block">{item.zone.name}</span>
            <span className="mt-0.5 block text-xs text-muted">{item.zone.city}</span>
          </Field>
          {item.approvalStatus === 'REJECTED' && item.rejectionReason && (
            <Field label="Rejection reason">
              <span className="text-danger">{item.rejectionReason}</span>
            </Field>
          )}
          {item.approvalStatus === 'APPROVED' && item.approvedAt && (
            <Field label="Approved">{formatDateTime(item.approvedAt)}</Field>
          )}
          <Field label="Created">{formatDateTime(item.createdAt)}</Field>
          <Field label="Updated">{formatDateTime(item.updatedAt)}</Field>
        </dl>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {onEdit && (
            <Button type="button" onClick={onEdit}>
              <Pencil className="size-4" /> Edit item
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
