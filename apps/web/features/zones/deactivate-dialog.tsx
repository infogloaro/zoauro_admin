'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Zone } from '@zoauro/shared';
import { ReauthDialog } from '../auth/reauth-dialog';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ApiError } from '../../lib/api';
import { useDeactivateZone, useZoneImpact } from './api';

const SOURCE_LABELS: Record<string, string> = {
  orders: 'Orders',
  restaurants: 'Restaurants',
  homemakers: 'Homemakers',
  delivery_partners: 'Delivery partners',
  customers: 'Customers',
  admin_zone_assignments: 'Zone teams',
};

/**
 * Deactivate with impact warning (doc 20, doc 09 DELETE /zones/{id}).
 * While `impact.complete` is false (F1.1 tables pending) the server refuses
 * with 409 — we surface that message instead of implying zero impact.
 * 401 REAUTH_REQUIRED opens the password confirm and retries.
 */
export function DeactivateDialog({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const impact = useZoneImpact(zone.id);
  const deactivate = useDeactivateZone();
  const [error, setError] = useState<ApiError | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const data = impact.data?.data;
  const pending = deactivate.isPending;

  async function submit() {
    setError(null);
    try {
      await deactivate.mutateAsync(zone.id);
      toast.success(`${zone.name} deactivated`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 && err.code === 'REAUTH_REQUIRED') {
          setReauthOpen(true);
          return;
        }
        setError(err);
        return;
      }
      toast.error('Could not reach the server. Try again.');
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {zone.name}?</DialogTitle>
            <DialogDescription>
              The zone moves to Inactive and stops appearing as an active service zone. You can
              re-activate it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {data?.complete ? (
              <ul className="grid grid-cols-2 gap-2">
                <li>Open orders: {data.counts.openOrders}</li>
                <li>Restaurants: {data.counts.restaurants}</li>
                <li>Homemakers: {data.counts.homemakers}</li>
                <li>Delivery partners: {data.counts.deliveryPartners}</li>
                <li>Customers: {data.counts.customers}</li>
                <li>Zonal admins: {data.counts.zonalAdmins}</li>
              </ul>
            ) : (
              <div className="flex gap-2 rounded-[--radius-input] border border-[#fde68a] bg-[#fffbeb] p-3 text-[#92400e]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Impact check incomplete</p>
                  <p className="mt-1 text-xs">
                    Related records are not queryable until those modules are migrated, so
                    deactivation is refused rather than assumed safe. Pending:{' '}
                    {(data?.pendingSources ?? []).map((s) => SOURCE_LABELS[s] ?? s).join(', ') ||
                      '—'}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-[--radius-input] bg-[#fee2e2] p-3 text-[#b91c1c]"
              >
                <p className="font-medium">Deactivation blocked</p>
                <p className="mt-1 text-xs">{error.message}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submit()}
              disabled={pending || impact.isPending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Deactivate zone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReauthDialog
        key={attempt}
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setAttempt((n) => n + 1);
          void submit();
        }}
      />
    </>
  );
}
