'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CLAIMS_LOOKUP_MAX,
  recordClaimedMetaSchema,
  type ClaimEntityType,
  type RecordClaimedMeta,
} from '@zoauro/shared';
import { useCallback } from 'react';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';
import { isApiError } from '../auth/errors';

// D174 record claims: who is working an onboarding record right now. One record's claim (its banner), the open claims
// of a page of rows (list badges, at most 100 a call) and the caller's own ("My reviews"). Until the realtime events
// land, the banner looks again every 20 s so a takeover request reaches the claimer without a reload.

export const CLAIM_REFRESH_MS = 20_000;

export const claimKeys = {
  all: ['claims'] as const,
  one: (t: ClaimEntityType, id: string) => ['claims', 'one', t, id] as const,
  many: (t: ClaimEntityType, ids: readonly string[]) => ['claims', 'many', t, ids] as const,
  mine: ['claims', 'mine'] as const,
};

export function useRecordClaim(entityType: ClaimEntityType, entityId: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: claimKeys.one(entityType, entityId),
    enabled,
    queryFn: async ({ signal }) => {
      const res = await client.get('/claims', {
        query: { entityType, entityId: [entityId] },
        signal,
      });
      return res.data[0] ?? null;
    },
    refetchInterval: CLAIM_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

/** The open claims among a page of rows, by entity id (rows out of the caller's scope are simply absent). */
export function useClaimsFor(entityType: ClaimEntityType, ids: readonly string[]) {
  const client = useApiClient();
  const some = ids.slice(0, CLAIMS_LOOKUP_MAX);
  return useQuery({
    queryKey: claimKeys.many(entityType, some),
    enabled: some.length > 0,
    queryFn: async ({ signal }) => {
      const res = await client.get('/claims', {
        query: { entityType, entityId: [...some] },
        signal,
      });
      return new Map(res.data.map((c) => [c.entityId, c]));
    },
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useMyClaims(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: claimKeys.mine,
    enabled,
    queryFn: ({ signal }) => client.get('/claims/mine', { signal }),
    // in the shell on every page: fresh for its refresh interval, so a page change does not ask again (a claim taken or
    // released here invalidates it)
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

export function useInvalidateClaims() {
  const qc = useQueryClient();
  // the menu badges carry my open claims (My reviews asks for its list only when there is one)
  return useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: claimKeys.all }),
        qc.invalidateQueries({ queryKey: ['menu-badges'] }),
      ]),
    [qc],
  );
}

/** 409 RECORD_CLAIMED (a claim, or a save on a record someone else holds): who holds it, or null. */
export function claimedBy(err: unknown): RecordClaimedMeta | null {
  if (!isApiError(err, 'RECORD_CLAIMED')) return null;
  const meta = recordClaimedMetaSchema.safeParse(err.meta);
  return meta.success ? meta.data : null;
}

/** The plain sentence for a save refused because someone else is reviewing the record. */
export function claimedMessage(err: unknown): string | null {
  if (!isApiError(err, 'RECORD_CLAIMED')) return null;
  const m = claimedBy(err);
  return m
    ? `${m.claimedBy.name} is reviewing this right now, so it can’t be changed. Ask them to hand it over, or wait until ${clock(m.expiresAt)}.`
    : 'Someone else is reviewing this right now, so it can’t be changed.';
}

/** "14:05" in India time. */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Where each claimed record's page is, per role (for "My reviews"). */
export function claimHref(
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN',
  entityType: ClaimEntityType,
  entityId: string,
): string {
  const base = role === 'SUPER_ADMIN' ? '/super-admin' : '/zone';
  const path = {
    HOTEL: 'hotels',
    RESTAURANT: 'restaurants',
    HOMEMAKER: 'homemakers',
    DELIVERY_PARTNER: 'delivery-partners',
  }[entityType];
  return `${base}/${path}/${entityId}`;
}

export const ENTITY_NOUN: Record<ClaimEntityType, string> = {
  HOTEL: 'Hotel',
  RESTAURANT: 'Restaurant',
  HOMEMAKER: 'Home Food provider',
  DELIVERY_PARTNER: 'Delivery partner',
};
