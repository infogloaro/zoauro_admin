import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe('HomePage', () => {
  it('renders the product name while redirecting to login', () => {
    expect(renderToStaticMarkup(<HomePage />)).toContain('ZOAURO Admin');
  });
});
