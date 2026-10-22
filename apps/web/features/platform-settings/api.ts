'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@zoauro/api-client';
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

/** `enabled` false: the member holds no settings area (D178), so GET /settings would answer 403. */
export function usePlatformSettings(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: settingKeys.all,
    enabled,
    queryFn: ({ signal }) => client.get('/settings', { signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/**
 * A zone's effective values. D178: a non-primary Super Admin reads only the settings groups granted (`areas`, null =
 * every group); a group refused anyway (403) is left out rather than failing the whole view.
 */
export function useZoneSettings(zoneId: string | null, areas: readonly string[] | null = null) {
  const client = useApiClient();
  const groups = ZONE_GROUPS.filter((g) => areas === null || areas.includes(`settings.${g}`));
  return useQuery({
    queryKey: [...settingKeys.zone(zoneId ?? ''), groups],
    enabled: zoneId !== null,
    queryFn: async ({ signal }) => {
      const answers = await Promise.allSettled(
        groups.map((group) =>
          client.get('/settings/{group}', {
            params: { group },
            query: { zoneId: zoneId ?? '' },
            signal,
          }),
        ),
      );
      const failed = answers.find(
        (a): a is PromiseRejectedResult =>
          a.status === 'rejected' && !(a.reason instanceof ApiError && a.reason.status === 403),
      );
      if (failed) throw failed.reason;
      return answers
        .flatMap((a) => (a.status === 'fulfilled' ? a.value.data : []))
        .filter((s) => s.zoneOverride);
    },
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useZoneOptions(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['zones', 'list', 'global', { limit: 100, picker: true }],
    enabled,
    queryFn: ({ signal }) => client.get('/zones', { query: { limit: 100 }, signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

export function useInvalidateSettings() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['settings'] }), [qc]);
}
