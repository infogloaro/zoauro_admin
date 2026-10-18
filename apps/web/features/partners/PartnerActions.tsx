'use client';

import {
  VERIFICATION_NOTE,
  type PartnerStatusTarget,
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
import { useInvalidatePartners } from './api';
import { FORCE_OFFLINE_MAX_DAYS, offlineUntil } from './labels';

// Partner decisions (approved list items 6–9, doc 10 section 5, D131–D133): status (activate, deactivate, suspend),
// verification (verify, or reject with a note: the "more information" request of R12), force offline until a time
// with a reason sent to the partner app, move zone (Super Admin, reason; PASSWORD), soft delete (PASSWORD, never an
// active partner or one carrying orders), and a document's verification. Each is confirmed; the API decides.

export type PartnerAction =
  | { kind: 'status'; to: PartnerStatusTarget }
  | { kind: 'verify'; decision: VerificationDecision }
  | { kind: 'offline' }
  | { kind: 'move' }
  | { kind: 'delete' }
  | { kind: 'doc'; docId: string; docLabel: string; decision: VerificationDecision };

interface Copy {
  title: string;
  text: string;
  button: string;
  danger: boolean;
  noteLabel: string;
  noteRequired: boolean;
  noteMin: number;
  done: string;
}

function copyFor(a: PartnerAction, name: string): Copy {
  const base = { danger: false, noteLabel: 'Note', noteRequired: false, noteMin: 1 };
  switch (a.kind) {
    case 'status':
      return a.to === 'ACTIVE'
        ? {
            ...base,
            title: `Activate ${name}?`,
            text: 'They can go online and take orders in their zone.',
            button: 'Activate',
            done: `${name} is active`,
          }
        : a.to === 'INACTIVE'
          ? {
              ...base,
              title: `Deactivate ${name}?`,
              text: 'They cannot take new orders. Their history is kept.',
              button: 'Deactivate',
              danger: true,
              noteLabel: 'Reason',
              noteRequired: true,
              done: `${name} is inactive`,
            }
          : {
              ...base,
              title: `Suspend ${name}?`,
              text: 'For a policy or safety problem: no orders until reactivated.',
              button: 'Suspend',
              danger: true,
              noteLabel: 'Reason',
              noteRequired: true,
              done: `${name} is suspended`,
            };
    case 'verify':
      return a.decision === 'VERIFIED'
        ? {
            ...base,
            title: `Verify ${name}?`,
            text: 'Their documents and details are checked. They can then be activated.',
            button: 'Verify',
            done: `${name} is verified`,
          }
        : {
            ...base,
            title: `Reject ${name}?`,
            text: 'The note is sent to the partner app as what to fix or add (more information).',
            button: 'Reject',
            danger: true,
            noteLabel: 'What is missing or wrong',
            noteRequired: true,
            noteMin: VERIFICATION_NOTE.min,
            done: `${name} was rejected`,
          };
    case 'offline':
      return {
        ...base,
        title: `Take ${name} offline?`,
        text: `They cannot go online or take orders until the time you choose (at most ${FORCE_OFFLINE_MAX_DAYS} days). The reason is shown in the partner app.`,
        button: 'Take offline',
        danger: true,
        noteLabel: 'Reason',
        noteRequired: true,
        noteMin: 3,
        done: `${name} is offline`,
      };
    case 'move':
      return {
        ...base,
        title: `Move ${name} to another zone?`,
        text: 'Refused while they carry orders. Their history moves with them.',
        button: 'Move',
        noteLabel: 'Reason',
        noteRequired: true,
        noteMin: 10,
        done: `${name} was moved`,
      };
    case 'delete':
      return {
        ...base,
        title: `Delete ${name}?`,
        text: 'They disappear from the lists; their deliveries and documents are kept (soft delete).',
        button: 'Delete',
        danger: true,
        done: `${name} was deleted`,
      };
    case 'doc':
      return a.decision === 'VERIFIED'
        ? {
            ...base,
            title: `Accept the ${a.docLabel}?`,
            text: 'You have opened and checked the file.',
            button: 'Accept',
            done: `${a.docLabel} accepted`,
          }
        : {
            ...base,
            title: `Reject the ${a.docLabel}?`,
            text: 'The partner is asked for a new file. Say what is wrong.',
            button: 'Reject',
            danger: true,
            noteLabel: 'What is wrong',
            noteRequired: true,
            done: `${a.docLabel} rejected`,
          };
  }
}

export function PartnerActionDialog({
  partner,
  action,
  zones,
  onClose,
  onDone,
}: {
  partner: { id: string; name: string; zone: { id: string } | null; version: number };
  action: PartnerAction | null;
  zones: ScopeZone[];
  onClose: () => void;
  onDone?: (action: PartnerAction) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidatePartners();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [text, setText] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setText('');
    setZoneId('');
    setUntil('');
    setAlert(null);
  }, [action]);

  if (!action) return dialog;
  const copy = copyFor(action, partner.name);
  const note = text.trim();
  const untilIso = offlineUntil(until);
  const ready =
    (!copy.noteRequired || note.length >= copy.noteMin) &&
    (action.kind !== 'move' || zoneId !== '') &&
    (action.kind !== 'offline' || untilIso !== null);

  const run = async () => {
    setAlert(null);
    setBusy(true);
    const params = { id: partner.id };
    try {
      await guarded(copy.title.replace(/\?$/, ''), 'PASSWORD', async () => {
        switch (action.kind) {
          case 'status':
            await client.post('/delivery-partners/{id}/status', {
              params,
              body: { status: action.to, ...(note ? { reason: note } : {}) },
            });
            break;
          case 'verify':
            await client.post('/delivery-partners/{id}/verification', {
              params,
              body: { decision: action.decision, ...(note ? { note } : {}) },
            });
            break;
          case 'offline':
            await client.post('/delivery-partners/{id}/force-offline', {
              params,
              body: { reason: note, until: untilIso ?? '' },
            });
            break;
          case 'move':
            await client.post('/delivery-partners/{id}/move-zone', {
              params,
              body: { zoneId, reason: note },
            });
            break;
          case 'delete':
            await client.delete('/delivery-partners/{id}', { params });
            break;
          case 'doc':
            await client.post('/delivery-partners/{id}/documents/{docId}/verify', {
              params: { id: partner.id, docId: action.docId },
              body: { decision: action.decision, ...(note ? { note } : {}) },
            });
            break;
        }
      });
      toast({ title: copy.done });
      await invalidate();
      onClose();
      onDone?.(action);
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
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
                  .filter((z) => z.id !== partner.zone?.id)
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({z.code})
                    </option>
                  ))}
              </select>
            </FormField>
          ) : null}
          {action.kind === 'offline' ? (
            <FormField
              label="Offline until (India time)"
              hint={
                until && !untilIso
                  ? `Pick a time in the next ${FORCE_OFFLINE_MAX_DAYS} days`
                  : undefined
              }
            >
              <input
                type="datetime-local"
                className={inputClass()}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </FormField>
          ) : null}
          {action.kind !== 'delete' ? (
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
          ) : null}
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
