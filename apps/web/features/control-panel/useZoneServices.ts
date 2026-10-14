'use client';

import { useQuery } from '@tanstack/react-query';
import type { ZoneServiceKind } from '@zoauro/shared';
import { useCallback } from 'react';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { retryTransient } from '../audit/useAuditLogs';
import { useInvalidateZones } from '../zones/api';

// Per-zone service switches (D92, Super Admin only): read one zone's switches with their history, and switch one
// service in one zone (PUT /zones/{id}/services, PASSWORD re-auth). Every zone view refreshes after a switch.

export function useZoneServices(zoneId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['zones', 'services', zoneId],
    queryFn: ({ signal }) => client.get('/zones/{id}/services', { params: { id: zoneId }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** Returns switch(zone, service, on): resolves true when saved, false when cancelled or refused (a toast says why). */
export function useSwitchService() {
  const client = useApiClient();
  const invalidate = useInvalidateZones();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();

  const switchService = useCallback(
    async (
      zone: { id: string; name: string },
      service: ZoneServiceKind,
      label: string,
      enabled: boolean,
    ): Promise<boolean> => {
      try {
        await guarded(
          `${enabled ? 'Switch on' : 'Switch off'} ${label} in ${zone.name}`,
          'PASSWORD',
          async () => {
            await client.put('/zones/{id}/services', {
              params: { id: zone.id },
              body: { services: { [service]: enabled } },
            });
          },
        );
        toast({
          title: `${label} ${enabled ? 'on' : 'off'} in ${zone.name}`,
          description: enabled
            ? 'Admins can work with it in this zone again.'
            : 'New onboarding and new orders for it are refused in this zone.',
        });
        await invalidate();
        return true;
      } catch (err) {
        if (err instanceof ReauthCancelled) return false;
        toast({
          tone: 'error',
          title: `${label} was not switched`,
          description: isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN,
        });
        return false;
      }
    },
    [client, guarded, invalidate, toast],
  );

  return { switchService, dialog };
}
