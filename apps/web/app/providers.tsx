'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '../components/ui/toast';
import { ApiClientProvider } from '../lib/api-client';

// Client-side providers for the whole app: TanStack Query (server state, doc 23), the typed API client and toasts.
export function Providers({ children }: { children: ReactNode }) {
  // one QueryClient per browser tab; created in state so it survives re-renders but is never shared between requests
  const [queries] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queries}>
      <ApiClientProvider>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
