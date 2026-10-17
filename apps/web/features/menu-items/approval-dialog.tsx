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
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/input';

/**
 * Approval decision dialog (doc 10 §4 style): REJECTED requires a reason,
 * APPROVED / ARCHIVED take an optional note. The reason is stored on the
 * record and in the audit row.
 */
export function ApprovalDialog({
  itemName,
  decision,
  busy = false,
  onSubmit,
  onClose,
}: {
  itemName: string;
  decision: 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  busy?: boolean;
  onSubmit: (reason: string | undefined) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const rejecting = decision === 'REJECTED';
  const reasonRequired = rejecting && reason.trim().length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {rejecting
              ? `Reject ${itemName}`
              : decision === 'APPROVED'
                ? `Approve ${itemName}`
                : `Archive ${itemName}`}
          </DialogTitle>
          <DialogDescription>
            {rejecting
              ? 'Tell the provider why the item was rejected. A reason is required.'
              : decision === 'APPROVED'
                ? 'Confirm the item was reviewed and is ready to appear on the menu.'
                : 'Archive the item so it is hidden from the active menu but kept for the record.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="approval-reason">
            Reason {rejecting && <span className="text-danger">*</span>}
          </Label>
          <Textarea
            id="approval-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder={rejecting ? 'Price photo missing' : 'Optional note'}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={rejecting ? 'destructive' : 'default'}
            disabled={busy || reasonRequired}
            onClick={() => onSubmit(reason.trim() === '' ? undefined : reason.trim())}
          >
            {rejecting ? 'Reject item' : decision === 'APPROVED' ? 'Approve item' : 'Archive item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
