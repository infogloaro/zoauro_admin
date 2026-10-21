import { describe, expect, it } from 'vitest';
import { expireAll } from './worker.rewards';

// D169: the daily expiry runs expireDue() in batches until one expires nothing, and never forever.

describe('reward points expiry run', () => {
  it('sums the batches and stops at the first empty one', async () => {
    const batches = [120, 40, 0, 999];
    let calls = 0;
    const total = await expireAll({ expireDue: async () => batches[calls++] ?? 0 });
    expect(total).toBe(160);
    expect(calls).toBe(3);
  });

  it('stops after the batch cap and says so (the rest waits for the next run)', async () => {
    const lines: string[] = [];
    let calls = 0;
    const total = await expireAll({ expireDue: async () => (calls++, 1) }, (l) => lines.push(l));
    expect(calls).toBe(40);
    expect(total).toBe(40);
    expect(lines.join()).toContain('next run');
  });
});
