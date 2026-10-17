import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';
import { EmptyState, ErrorState } from './states';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/super-admin/zones',
}));

describe('PageHeader', () => {
  it('renders title, subtitle and actions', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Zone Management"
        subtitle="Manage zones"
        actions={<button>Add Zone</button>}
      />,
    );
    expect(html).toContain('Zone Management');
    expect(html).toContain('Manage zones');
    expect(html).toContain('Add Zone');
  });
});

describe('StatCard', () => {
  it('renders label and value', () => {
    const html = renderToStaticMarkup(
      <StatCard label="Total Zones" value={8} icon={<svg />} tone="info" />,
    );
    expect(html).toContain('Total Zones');
    expect(html).toContain('>8<');
  });

  it('has the orange hover and focus-visible states with a 200 ms transition', () => {
    const html = renderToStaticMarkup(<StatCard label="Total Zones" value={8} icon={<svg />} />);
    expect(html).toContain('transition-colors');
    expect(html).toContain('duration-200');
    expect(html).toContain('hover:border-orange-300');
    expect(html).toContain('hover:bg-orange-50/60');
    expect(html).toContain('hover:shadow-md');
    expect(html).toContain('focus-visible:ring-orange-500/40');
  });
});

describe('EmptyState', () => {
  it('shows the one-line explanation and optional action', () => {
    const html = renderToStaticMarkup(
      <EmptyState message="No zones yet" action={<button>Create</button>} />,
    );
    expect(html).toContain('No zones yet');
    expect(html).toContain('Create');
  });
});

describe('ErrorState', () => {
  it('shows message, requestId and a retry button (doc 22 §4)', () => {
    const html = renderToStaticMarkup(
      <ErrorState message="Boom" requestId="req-123" onRetry={() => {}} />,
    );
    expect(html).toContain('Boom');
    expect(html).toContain('req-123');
    expect(html).toContain('Retry');
  });
});
