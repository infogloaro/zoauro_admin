import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('HomePage', () => {
  it('renders the product name', () => {
    expect(renderToStaticMarkup(<HomePage />)).toContain('ZOAURO Admin');
  });
});
