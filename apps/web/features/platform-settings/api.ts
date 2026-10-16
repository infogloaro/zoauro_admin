'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTING_GROUPS, SETTINGS, type SettingGroup } from '@zoauro/shared';
import { useCallback } from 'react';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Platform settings server state (doc 59 §5). The platform view comes from GET /settings; a zone view reads each group
// that has zone-overridable keys with ?zoneId= (the effective value in that zone and where it comes from, D109).

export const settingKeys = {
  all: ['settings', 'platform'] as const,
  zone: (zoneId: string) => ['settings', 'platform', 'zone', zoneId] as const,
};

/** groups with at least one key a zone may override */
export const ZONE_GROUPS: SettingGroup[] = SETTING_GROUPS.filter((g) =>
  SETTINGS.some((s) => s.group === g && s.zoneOverride),
);

/** One setting as the API returns it (the generated client types `unknown` fields as optional). */
export type SettingItem = NonNullable<
  ReturnType<typeof usePlatformSettings>['data']
>['data'][number];

export function usePlatformSettings() {
  const client = useApiClient();
  return useQuery({
    queryKey: settingKeys.all,
    queryFn: ({ signal }) => client.get('/settings', { signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useZoneSettings(zoneId: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: settingKeys.zone(zoneId ?? ''),
    enabled: zoneId !== null,
    queryFn: async ({ signal }) => {
      const groups = await Promise.all(
        ZONE_GROUPS.map((group) =>
          client.get('/settings/{group}', {
            params: { group },
            query: { zoneId: zoneId ?? '' },
            signal,
          }),
        ),
      );
      return groups.flatMap((g) => g.data).filter((s) => s.zoneOverride);
    },
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useZoneOptions() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['zones', 'list', 'global', { limit: 100, picker: true }],
    queryFn: ({ signal }) => client.get('/zones', { query: { limit: 100 }, signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

export function useInvalidateSettings() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['settings'] }), [qc]);
}
