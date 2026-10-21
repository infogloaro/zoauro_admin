'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '../components/ui/toast';
import { ApiClientProvider } from '../lib/api-client';
import { noteQueryFailure, queryRetryDelay } from '../lib/busy';

// Client-side providers for the whole app: TanStack Query (server state, doc 23), the typed API client and toasts.
export function Providers({ children }: { children: ReactNode }) {
  // one QueryClient per browser tab; created in state so it survives re-renders but is never shared between requests;
  // a 503 is noted so error panels can say the system is busy (lib/busy)
  const [queries] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (err) => noteQueryFailure(err) }),
        defaultOptions: { queries: { refetchOnWindowFocus: false, retryDelay: queryRetryDelay } },
      }),
  );
  return (
    <QueryClientProvider client={queries}>
      <ApiClientProvider>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
