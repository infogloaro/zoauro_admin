'use client';

import {
  putSuperAdminAreasSchema,
  setSuperAdminPrimarySchema,
  type SuperAdmin,
} from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormAlert, FormField } from '../../../components/ui/field';
import { inputClass } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { useInvalidateSuperAdmins } from './api';
import { AreaPicker, type Catalogue } from './AreaPicker';
import { REASON_MIN, superAdminProblem } from './SuperAdminDialogs';

// D178 (owner's final design): a primary Super Admin grants a non-primary one the Control Panel areas they run, and
// promotes or demotes primaries. Both need a reason and the password and a code (STRONG); the last primary can never
// be demoted (409 LAST_PRIMARY); a non-primary gets 403 PRIMARY_ONLY.

export function AreasDialog({
  target,
  catalogue,
  onClose,
}: {
  target: SuperAdmin;
  catalogue: Catalogue;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateSuperAdmins();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [areas, setAreas] = useState<string[]>([...target.areas]);
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = putSuperAdminAreasSchema.safeParse({ areas, reason: reason.trim() });

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      await guarded(`Change ${target.name}'s areas`, 'STRONG', async () => {
        await client.put('/super-admins/{id}/areas', {
          params: { id: target.id },
          body: parsed.data,
        });
      });
      toast({ title: `${target.name}'s areas saved` });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(superAdminProblem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <div>
            <DialogTitle>Control Panel areas of {target.name}</DialogTitle>
            <DialogDescription>
              They run every zone's operations; in the Control Panel only the areas ticked here.
              Their menu changes at their next page load. Asks for your password and a code.
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <AreaPicker catalogue={catalogue} value={areas} onChange={setAreas} />
          <FormField
            label="Reason"
            hint={`At least ${REASON_MIN} characters, kept in the audit log`}
          >
            <textarea
              className={inputClass('min-h-16 py-2')}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void run()} disabled={busy || !parsed.success}>
              Save areas
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

export function PrimaryDialog({ target, onClose }: { target: SuperAdmin; onClose: () => void }) {
  const client = useApiClient();
  const invalidate = useInvalidateSuperAdmins();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const primary = !target.isPrimary;
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAlert(null), [target.id]);
  const parsed = setSuperAdminPrimarySchema.safeParse({ primary, reason: reason.trim() });

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      await guarded(
        primary ? `Make ${target.name} primary` : `Remove ${target.name}'s primary role`,
        'STRONG',
        async () => {
          await client.post('/super-admins/{id}/primary', {
            params: { id: target.id },
            body: parsed.data,
          });
        },
      );
      toast({
        title: primary
          ? `${target.name} is a primary Super Admin`
          : `${target.name} is no longer primary`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(superAdminProblem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div>
            <DialogTitle>
              {primary
                ? `Make ${target.name} a primary Super Admin?`
                : `Remove ${target.name}'s primary role?`}
            </DialogTitle>
            <DialogDescription>
              {primary
                ? 'A primary holds every Control Panel area and manages Super Admins: adds, removes, grants areas and promotes. Asks for your password and a code.'
                : 'They keep running every zone, with only the Control Panel areas you grant them afterwards. The last primary cannot be removed. Asks for your password and a code.'}
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <FormField
            label="Reason"
            hint={`At least ${REASON_MIN} characters, kept in the audit log`}
          >
            <textarea
              className={inputClass('min-h-16 py-2')}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={primary ? 'primary' : 'danger'}
              onClick={() => void run()}
              disabled={busy || !parsed.success}
            >
              {primary ? 'Make primary' : 'Remove primary role'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
