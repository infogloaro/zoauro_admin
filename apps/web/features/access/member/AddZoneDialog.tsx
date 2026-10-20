'use client';

import type { AccessProfileSummary } from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/field';
import { inputClass } from '../../../components/ui/input';
import { CardError, CardSkeleton } from '../../dashboard/parts';
import { ZONE_STATUS_LABEL } from '../../zones/format';
import { useAssignableZones } from './api';
import type { ZoneRef } from './draft';

// "Add zone" (D108): only ACTIVE or UPCOMING zones the member does not have yet; the profile defaults to the first one.
// Adding changes the draft only; the page's Save sends it.

export function AddZoneDialog({
  open,
  assigned,
  profiles,
  onClose,
  onAdd,
}: {
  open: boolean;
  assigned: ReadonlySet<string>;
  profiles: AccessProfileSummary[];
  onClose: () => void;
  onAdd: (zone: ZoneRef, profileId: string) => void;
}) {
  const zones = useAssignableZones(open);
  const free = (zones.data ?? []).filter((z) => !assigned.has(z.id));
  const [zoneId, setZoneId] = useState('');
  const [profileId, setProfileId] = useState('');

  useEffect(() => {
    if (!open) return;
    setZoneId('');
    setProfileId(profiles[0]?.id ?? '');
  }, [open, profiles]);

  const zone = free.find((z) => z.id === zoneId);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Add a zone</DialogTitle>
        <DialogDescription>
          Active or upcoming zones the member does not have yet. Saved with the page.
        </DialogDescription>
        {zones.isError ? (
          <CardError what="The zones" onRetry={() => void zones.refetch()} />
        ) : !zones.data ? (
          <CardSkeleton rows={2} />
        ) : free.length === 0 ? (
          <p className="text-sm text-muted">Every active or upcoming zone is already assigned.</p>
        ) : (
          <>
            <FormField label="Zone">
              <select
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                className={inputClass()}
              >
                <option value="">Choose a zone</option>
                {free.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.code}) · {ZONE_STATUS_LABEL[z.status]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Access profile">
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className={inputClass()}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!zone || !profileId}
            onClick={() => {
              if (!zone) return;
              onAdd(
                {
                  id: zone.id,
                  name: zone.name,
                  code: zone.code,
                  colorHex: zone.colorHex,
                  status: zone.status,
                },
                profileId,
              );
              onClose();
            }}
          >
            Add zone
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
