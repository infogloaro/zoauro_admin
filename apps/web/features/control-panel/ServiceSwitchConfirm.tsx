'use client';

import { PowerOff } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';

// Confirmation before a service is switched OFF in a zone (D92): it stops new onboarding and new orders for that service
// there. Switching ON needs no confirmation (the password is still asked).

export function ServiceSwitchConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { zoneName: string; label: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
          >
            <PowerOff className="size-5" />
          </span>
          <div>
            <DialogTitle>
              Switch off {pending?.label} in {pending?.zoneName}?
            </DialogTitle>
            <DialogDescription>
              New onboarding and new orders for {pending?.label} are refused in this zone. Open
              orders and existing records are not changed; switching it back on restores it.
            </DialogDescription>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Switch off
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
