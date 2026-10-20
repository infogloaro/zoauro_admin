'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReauthLevel } from '@zoauro/shared';
import { useCallback, useRef, useState } from 'react';
import { useApiClient } from '../../lib/api-client';
import { isApiError } from '../auth/errors';
import { ReauthDialog } from './ReauthDialog';

// Step-up for any sensitive action (doc 52 section 2.4, doc 14): run the action; when the API answers REAUTH_REQUIRED,
// ask for the password (PASSWORD) or the password and a code (STRONG), then run it once more. Errors other than
// REAUTH_REQUIRED are the caller's (the returned promise rejects with them).

interface Pending {
  title: string;
  level: ReauthLevel;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export function useReauthGuard() {
  const client = useApiClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const mfa = useQuery({
    queryKey: ['me', 'mfa'],
    queryFn: () => client.get('/me/mfa'),
    enabled: pending?.level === 'STRONG',
  });

  const guarded = useCallback(
    (title: string, level: ReauthLevel, action: () => Promise<void>): Promise<void> =>
      action().catch(
        (err: unknown) =>
          new Promise<void>((resolve, reject) => {
            if (!isApiError(err, 'REAUTH_REQUIRED')) {
              reject(err);
              return;
            }
            const p = { title, level, run: action, resolve, reject };
            pendingRef.current = p;
            setPending(p);
          }),
      ),
    [],
  );

  const dialog = (
    <ReauthDialog
      open={pending !== null}
      level={pending?.level ?? 'PASSWORD'}
      title={pending?.title ?? ''}
      enrolled={mfa.data?.methods.map((m) => m.type) ?? []}
      onCancel={() => {
        const p = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        p?.reject(new ReauthCancelled());
      }}
      onConfirmed={async () => {
        const p = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        if (!p) return;
        try {
          await p.run();
          p.resolve();
        } catch (err) {
          p.reject(err);
        }
      }}
    />
  );

  return { guarded, dialog };
}

/** The member closed the re-authentication dialog: nothing was done, nothing to report. */
export class ReauthCancelled extends Error {
  constructor() {
    super('re-authentication cancelled');
    this.name = 'ReauthCancelled';
  }
}
