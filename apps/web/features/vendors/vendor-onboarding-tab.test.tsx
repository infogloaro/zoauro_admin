import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { mockOnboarding } from './preview';
import { VendorOnboardingTab } from './vendor-onboarding-tab';

vi.mock('./api', () => ({
  useVendorOnboarding: vi.fn(),
  useSetReviewDeadline: vi.fn(),
}));

const { useVendorOnboarding, useSetReviewDeadline } = await import('./api');

function tabHtml() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <VendorOnboardingTab
        vendor={{
          kind: 'restaurant',
          id: 'a1000001-0000-4000-8000-000000000001',
          name: 'Preview Rst',
        }}
      />
    </QueryClientProvider>,
  );
}

const vendor = { kind: 'restaurant', id: 'a1000001-0000-4000-8000-000000000001' } as const;

describe('VendorOnboardingTab', () => {
  it('shows the loading skeleton while the query runs', () => {
    vi.mocked(useVendorOnboarding).mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
      error: null,
      refetch: () => Promise.resolve(),
    } as never);
    vi.mocked(useSetReviewDeadline).mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    } as never);
    expect(tabHtml()).toContain('aria-busy');
  });

  it('renders the provisional readiness score and every checklist reason', () => {
    vi.mocked(useVendorOnboarding).mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: mockOnboarding('restaurant', vendor.id) },
      error: null,
      refetch: () => Promise.resolve(),
    } as never);
    vi.mocked(useSetReviewDeadline).mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    } as never);
    const html = tabHtml();
    expect(html).toContain('Readiness');
    expect(html).toContain('0%');
    expect(html).toContain('provisional');
    expect(html).toContain('No document uploaded');
    expect(html).toContain('Advisory only');
    expect(html).toContain('Change deadline');
  });
});
