'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from '@zoauro/api-client';
import { withCsrf } from './csrf';

// One typed API client for the browser (doc 23 section 9: no hand-written fetch in components). The root layout mounts
// ApiClientProvider once; features read it with useApiClient(), and tests pass a fake.

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client?: ApiClient;
  children: ReactNode;
}) {
  const value = useMemo(
    () => client ?? createApiClient({ fetch: withCsrf((...args) => fetch(...args)) }),
    [client],
  );
  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('useApiClient needs an <ApiClientProvider> above it');
  return client;
}
