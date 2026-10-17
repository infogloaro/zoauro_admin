'use client';

import { useState } from 'react';
import type { VerificationDecision } from '@zoauro/shared';
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
 * Shared action dialogs for M06/M07 (doc 20 actions row; AGENTS.md: confirm
 * destructive actions, toasts for results — errors are toasted by the caller).
 */

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Verify / Reject review (doc 10 §4): rejecting requires a note, the same note
 * is stored on the record and in the audit row.
 */
export function VerificationDialog({
  vendorName,
  decision,
  noun = 'vendor',
  description,
  busy = false,
  onSubmit,
  onClose,
}: {
  vendorName: string;
  decision: VerificationDecision;
  /** Review target noun for the footer buttons ("vendor" or "document"). */
  noun?: string;
  /** Overrides the default reject/verify copy when reviewing a document. */
  description?: string;
  busy?: boolean;
  onSubmit: (note: string | undefined) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const rejecting = decision === 'REJECTED';
  const noteRequired = rejecting && note.trim().length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rejecting ? `Reject ${vendorName}` : `Verify ${vendorName}`}</DialogTitle>
          <DialogDescription>
            {description ??
              (rejecting
                ? 'Tell the vendor why the submission was rejected. A note is required.'
                : 'Confirm the documents and details were reviewed. A note is optional.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="verification-note">
            Note {rejecting && <span className="text-danger">*</span>}
          </Label>
          <Textarea
            id="verification-note"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder={rejecting ? 'FSSAI document missing' : 'Optional review note'}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={rejecting ? 'destructive' : 'default'}
            disabled={busy || noteRequired}
            onClick={() => onSubmit(note.trim() === '' ? undefined : note.trim())}
          >
            {rejecting ? `Reject ${noun}` : `Verify ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
