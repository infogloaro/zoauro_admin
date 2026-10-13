import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, statusTone } from './badge';

describe('statusTone', () => {
  it('maps statuses per doc 19 §2', () => {
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('DELIVERED')).toBe('success');
    expect(statusTone('INACTIVE')).toBe('danger');
    expect(statusTone('SUSPENDED')).toBe('danger');
    expect(statusTone('UPCOMING')).toBe('warning');
    expect(statusTone('PENDING')).toBe('warning');
    expect(statusTone('SOMETHING_ELSE')).toBe('neutral');
  });
});

describe('Badge', () => {
  it('renders the visible text (no colour-only status)', () => {
    const html = renderToStaticMarkup(<Badge tone="success">Active</Badge>);
    expect(html).toContain('Active');
    expect(html).toContain('bg-[#dcfce7]');
  });
});
