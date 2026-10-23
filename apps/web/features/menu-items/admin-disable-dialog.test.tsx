import { describe, expect, it } from 'vitest';
import { adminDisableCanSubmit } from './admin-disable-dialog';

describe('adminDisableCanSubmit — D126: disabling needs a reason (schema min 1, max 300)', () => {
  it('keeps submit disabled until a reason is typed', () => {
    expect(adminDisableCanSubmit('')).toBe(false);
    expect(adminDisableCanSubmit('   ')).toBe(false);
  });

  it('accepts a trimmed reason within the limit', () => {
    expect(adminDisableCanSubmit('Policy violation — unverified photo')).toBe(true);
    expect(adminDisableCanSubmit('x'.repeat(300))).toBe(true);
  });

  it('refuses reasons beyond the 300-character cap', () => {
    expect(adminDisableCanSubmit('x'.repeat(301))).toBe(false);
  });
});
