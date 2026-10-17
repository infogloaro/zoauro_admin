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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Input } from '../../components/ui/input';

/**
 * Status-transition dialog (doc 10 state machines): the caller offers only
 * the legal next statuses; a note is optional and lands on the record plus
 * the audit row. Cancelling a PAID booking marks the payment REFUNDED
 * server-side, so the refunds KPI stays truthful.
 */
export function StatusDialog({
  title,
  description,
  options,
  requireNote = false,
  noteLabel = 'Note',
  busy = false,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  options: Array<{ value: string; label: string }>;
  requireNote?: boolean;
  noteLabel?: string;
  busy?: boolean;
  onSubmit: (status: string, note: string | undefined) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const canSubmit = status !== '' && (!requireNote || note.trim().length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="status-target">
              New status <span className="text-danger">*</span>
            </Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="status-target">
                <SelectValue placeholder="Choose a status" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="status-note">
              {noteLabel} {requireNote && <span className="text-danger">*</span>}
            </Label>
            <Input
              id="status-note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder={requireNote ? 'Reason for this change' : 'Optional note'}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !canSubmit}
            onClick={() => onSubmit(status, note.trim() || undefined)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
