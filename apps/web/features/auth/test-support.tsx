import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { ApiClientProvider } from '../../lib/api-client';

// Test helpers for the sign-in and account screens: a fake typed client answering "METHOD /path" routes, and the
// providers the screens need. Test-only (imported by *.test.tsx files).

type Handler = (init: { body?: unknown; params?: Record<string, string> } | undefined) => unknown;

export interface FakeCall {
  route: string;
  body?: unknown;
  params?: Record<string, string> | undefined;
}

export function fakeClient(routes: Record<string, Handler>) {
  const calls: FakeCall[] = [];
  const method =
    (verb: string) =>
    async (path: string, init?: { body?: unknown; params?: Record<string, string> }) => {
      const route = `${verb} ${path}`;
      calls.push({ route, body: init?.body, params: init?.params });
      const handler = routes[route];
      if (!handler) throw new Error(`unexpected call ${route}`);
      return handler(init);
    };
  const client = {
    get: method('GET'),
    post: method('POST'),
    put: method('PUT'),
    patch: method('PATCH'),
    delete: method('DELETE'),
    request: vi.fn(),
    clearSession: vi.fn(),
  } as unknown as ApiClient;
  return { client, calls, routes: (r: string) => calls.filter((c) => c.route === r) };
}

export const apiError = (
  status: number,
  code: ConstructorParameters<typeof ApiError>[1],
  message = 'error',
  details: { field: string; issue: string }[] = [],
) => new ApiError(status, code, message, details);

export function Providers({ client, children }: { client: ApiClient; children: ReactNode }) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
