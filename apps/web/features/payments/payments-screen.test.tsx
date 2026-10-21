import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentsScreen, csvEscape } from './payments-screen';
import { DEMO_PAYMENTS } from './demo-payments';

describe('PaymentsScreen', () => {
  it('renders 12 demo transactions', () => {
    const html = renderToStaticMarkup(<PaymentsScreen />);
    expect(html).toContain('DEMO-PAY-1001');
    expect(html).toContain('DEMO-PAY-1006');
    expect(DEMO_PAYMENTS).toHaveLength(12);
  });

  it('csvEscape handles commas quotes and newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape(42)).toBe('42');
  });
});
