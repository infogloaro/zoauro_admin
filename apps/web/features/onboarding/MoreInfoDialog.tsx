'use client';

import { useQueryClient } from '@tanstack/react-query';
import { onboardingMoreInfoSchema, type OnboardingModule } from '@zoauro/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { onboardingProblem, requestMoreInfo } from './record-actions';

// Ask the vendor for more information (D170), from the onboarding queue or the record's page: the message goes to the
// vendor app and the application waits for the vendor until they send it again.

export function MoreInfoDialog({
  record,
  onClose,
  onDone,
}: {
  record: { module: OnboardingModule; id: string; name: string };
  onClose: () => void;
  onDone?: () => void | Promise<void>;
}) {
  const client = useApiClient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = onboardingMoreInfoSchema.safeParse({ message: message.trim() });

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      await requestMoreInfo(client, record.module, record.id, parsed.data);
      toast({
        title: `Asked ${record.name} for more information`,
        description: 'It waits for the vendor now.',
      });
      await qc.invalidateQueries({ queryKey: ['onboarding'] });
      await onDone?.();
      onClose();
    } catch (err) {
      setAlert(onboardingProblem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>Ask {record.name} for more information?</DialogTitle>
          <DialogDescription>
            The message goes to the vendor app. The application shows “Waiting for vendor” until
            they send it again.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <FormField label="What is missing or needs fixing" hint="At least 5 characters">
          <textarea
            className={inputClass('min-h-24 py-2')}
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={busy || !parsed.success}>
            Send to the vendor
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
