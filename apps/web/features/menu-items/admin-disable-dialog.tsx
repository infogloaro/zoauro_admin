'use client';

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

/**
 * D126: the admin disable toggle writes `admin_disabled` (never the vendor's
 * `is_available`) and turning an item OFF requires a reason — the server
 * answers 422 without one. Turning it back on needs no reason and is a plain
 * PATCH from the row, so this dialog only covers the disabling direction.
 */
export function adminDisableCanSubmit(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= 300;
}

export function AdminDisableDialog({
  itemName,
  busy = false,
  onSubmit,
  onClose,
}: {
  itemName: string;
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const canSubmit = adminDisableCanSubmit(reason);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disable {itemName}</DialogTitle>
          <DialogDescription>
            The item is hidden from customers until an admin re-enables it. A reason is required and
            is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="admin-disable-reason">
            Reason <span className="text-danger">*</span>
          </Label>
          <Textarea
            id="admin-disable-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Policy violation — unverified photo"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !canSubmit}
            onClick={() => onSubmit(reason.trim())}
          >
            Disable item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
