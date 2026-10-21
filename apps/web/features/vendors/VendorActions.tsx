'use client';

import {
  VERIFICATION_NOTE,
  type VendorModule,
  type VendorStatusTarget,
  type VerificationDecision,
} from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { claimedMessage } from '../claims/api';
import { useInvalidateVendors } from './api';

// Vendor decisions (doc 10 section 4, doc 09, ported from Chittra Priya's vendor-actions, D117): status (activate,
// deactivate, suspend), verification (verify, or reject with a note), move to another zone (Super Admin only, reason),
// a soft delete (never an active vendor), and a document's verification (D120). Every one is confirmed in a dialog; the
// API asks for the password where a rule needs it (move zone, delete); nothing is reported as done unless the API says so.

export type VendorAction =
  | { kind: 'status'; to: VendorStatusTarget }
  | { kind: 'verify'; decision: VerificationDecision }
  | { kind: 'move' }
  | { kind: 'delete' }
  | { kind: 'doc'; docId: string; docLabel: string; decision: VerificationDecision };

const STATUS_COPY: Record<VendorStatusTarget, { verb: string; done: string; text: string }> = {
  ACTIVE: {
    verb: 'Activate',
    done: 'is active',
    text: 'Customers can order from them again in their zone.',
  },
  INACTIVE: {
    verb: 'Deactivate',
    done: 'is inactive',
    text: 'They stop receiving new orders. Open orders and their history are kept.',
  },
  SUSPENDED: {
    verb: 'Suspend',
    done: 'is suspended',
    text: 'For a policy or quality problem: no new orders until reactivated. Their history is kept.',
  },
};

export function VendorActionDialog({
  module,
  vendor,
  action,
  zones,
  onClose,
  onDone,
}: {
  module: VendorModule;
  vendor: { id: string; name: string; zone: { id: string } | null };
  action: VendorAction | null;
  zones: ScopeZone[];
  onClose: () => void;
  /** after the API confirmed it (e.g. leave the page after a delete) */
  onDone?: (action: VendorAction) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateVendors(module);
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [text, setText] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setText('');
    setZoneId('');
    setAlert(null);
  }, [action]);

  if (!action) return dialog;
  const base = module === 'restaurants' ? 'restaurants' : 'homemakers';

  const copy = (() => {
    switch (action.kind) {
      case 'status': {
        const c = STATUS_COPY[action.to];
        return {
          title: `${c.verb} ${vendor.name}?`,
          text: c.text,
          button: c.verb,
          danger: action.to !== 'ACTIVE',
          noteLabel: 'Reason',
          noteRequired: action.to !== 'ACTIVE',
          noteMin: 1,
          done: `${vendor.name} ${c.done}`,
        };
      }
      case 'verify':
        return action.decision === 'VERIFIED'
          ? {
              title: `Verify ${vendor.name}?`,
              text: 'Confirms their documents and details are checked. They can then be activated.',
              button: 'Verify',
              danger: false,
              noteLabel: 'Note',
              noteRequired: false,
              noteMin: VERIFICATION_NOTE.min,
              done: `${vendor.name} is verified`,
            }
          : {
              title: `Reject ${vendor.name}?`,
              text: 'They are told what to fix through the vendor app. The note is required.',
              button: 'Reject',
              danger: true,
              noteLabel: 'What is wrong',
              noteRequired: true,
              noteMin: VERIFICATION_NOTE.min,
              done: `${vendor.name} was rejected`,
            };
      case 'move':
        return {
          title: `Move ${vendor.name} to another zone?`,
          text: 'Their menu, documents and history move with them. Open orders stay in the old zone.',
          button: 'Move',
          danger: false,
          noteLabel: 'Reason',
          noteRequired: true,
          noteMin: 10,
          done: `${vendor.name} was moved`,
        };
      case 'delete':
        return {
          title: `Delete ${vendor.name}?`,
          text: 'They disappear from the lists. Their orders, documents and history are kept (soft delete).',
          button: 'Delete',
          danger: true,
          noteLabel: 'Note',
          noteRequired: false,
          noteMin: 1,
          done: `${vendor.name} was deleted`,
        };
      case 'doc':
        return action.decision === 'VERIFIED'
          ? {
              title: `Accept the ${action.docLabel}?`,
              text: 'You have opened and checked the file.',
              button: 'Accept',
              danger: false,
              noteLabel: 'Note',
              noteRequired: false,
              noteMin: 1,
              done: `${action.docLabel} accepted`,
            }
          : {
              title: `Reject the ${action.docLabel}?`,
              text: 'The vendor is asked for a new file. Say what is wrong.',
              button: 'Reject',
              danger: true,
              noteLabel: 'What is wrong',
              noteRequired: true,
              noteMin: 1,
              done: `${action.docLabel} rejected`,
            };
    }
  })();

  const note = text.trim();
  const ready =
    (!copy.noteRequired || note.length >= copy.noteMin) &&
    (action.kind !== 'move' || zoneId !== '');

  const run = async () => {
    setAlert(null);
    setBusy(true);
    try {
      await guarded(copy.title.replace(/\?$/, ''), 'PASSWORD', async () => {
        const params = { id: vendor.id };
        switch (action.kind) {
          case 'status': {
            const body = { status: action.to, ...(note ? { reason: note } : {}) };
            if (base === 'restaurants')
              await client.post('/restaurants/{id}/status', { params, body });
            else await client.post('/homemakers/{id}/status', { params, body });
            break;
          }
          case 'verify': {
            const body = { decision: action.decision, ...(note ? { note } : {}) };
            if (base === 'restaurants')
              await client.post('/restaurants/{id}/verification', { params, body });
            else await client.post('/homemakers/{id}/verification', { params, body });
            break;
          }
          case 'move': {
            const body = { zoneId, reason: note };
            if (base === 'restaurants')
              await client.post('/restaurants/{id}/move-zone', { params, body });
            else await client.post('/homemakers/{id}/move-zone', { params, body });
            break;
          }
          case 'delete': {
            if (base === 'restaurants') await client.delete('/restaurants/{id}', { params });
            else await client.delete('/homemakers/{id}', { params });
            break;
          }
          case 'doc': {
            const p = { id: vendor.id, docId: action.docId };
            const body = { decision: action.decision, ...(note ? { note } : {}) };
            if (base === 'restaurants')
              await client.post('/restaurants/{id}/documents/{docId}/verify', { params: p, body });
            else
              await client.post('/homemakers/{id}/documents/{docId}/verify', { params: p, body });
            break;
          }
        }
      });
      toast({ title: copy.done });
      await invalidate();
      onClose();
      onDone?.(action);
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(claimedMessage(err) ?? (isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.text}</DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          {action.kind === 'move' ? (
            <FormField label="New zone">
              <select
                className={inputClass()}
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                <option value="">Choose a zone</option>
                {zones
                  .filter((z) => z.id !== vendor.zone?.id)
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({z.code})
                    </option>
                  ))}
              </select>
            </FormField>
          ) : null}
          <FormField
            label={copy.noteRequired ? copy.noteLabel : `${copy.noteLabel} (optional)`}
            hint={
              copy.noteRequired && copy.noteMin > 1
                ? `At least ${copy.noteMin} characters`
                : undefined
            }
          >
            <textarea
              className={inputClass('min-h-20 py-2')}
              maxLength={300}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={copy.danger ? 'danger' : 'primary'}
              onClick={() => void run()}
              disabled={busy || !ready}
            >
              {copy.button}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
