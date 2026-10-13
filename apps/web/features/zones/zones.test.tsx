// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { countOrDash, missingLabel, pincodeSummary } from './format';
import { PincodeEditor, rangeSize, type PincodeValue } from './PincodeEditor';
import { parseRupees } from './ZoneFormDialog';

// Zone Management screens (P16, doc 53 section 6): the display rules and the pincode editor's live overlap hint.

afterEach(cleanup);

describe('zone display rules', () => {
  it('a count from a module not built yet is a dash, never 0', () => {
    expect(countOrDash(0, 'restaurants', ['restaurants'])).toBe('—');
    expect(countOrDash(1200, 'restaurants', [])).toBe('1,200');
    expect(missingLabel(['restaurants', 'orders', 'refunds'])).toBe(
      'Restaurants, Orders and Refunds',
    );
    expect(missingLabel(['access'])).toBe('Access Control');
  });

  it('pincode summary names the entered range when there is one', () => {
    expect(pincodeSummary({ pincodeFrom: '600001', pincodeTo: '600040', pincodeCount: 40 })).toBe(
      '40 pincodes · 600001–600040',
    );
    expect(pincodeSummary({ pincodeFrom: null, pincodeTo: null, pincodeCount: 1 })).toBe(
      '1 pincode',
    );
  });

  it('delivery charge in rupees becomes integer paise; anything else is refused', () => {
    expect(parseRupees('45')).toBe(4500);
    expect(parseRupees('45.5')).toBe(4550);
    expect(parseRupees(' 0 ')).toBe(0);
    for (const bad of ['', '-1', '4.555', 'abc', '1e3']) expect(parseRupees(bad)).toBeNull();
  });

  it('range size: inclusive, null until both ends are valid pincodes', () => {
    expect(rangeSize('600001', '600040')).toBe(40);
    expect(rangeSize('600001', '6000')).toBeNull();
    expect(rangeSize('012345', '600040')).toBeNull();
  });
});

describe('pincode editor', () => {
  function setup(owners: Record<string, { id: string; name: string } | null>) {
    const get = vi.fn(async (path: string, init?: { query?: { pincode?: string } }) => {
      if (path !== '/zones/lookup') throw new Error(`unexpected GET ${path}`);
      const pincode = init?.query?.pincode ?? '';
      const z = owners[pincode] ?? null;
      return { pincode, zone: z ? { ...z, code: 'X', status: 'ACTIVE' } : null };
    });
    const client = { get } as unknown as ApiClient;
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Harness() {
      const [value, setValue] = useState<PincodeValue>({ from: '', to: '', extra: [] });
      return <PincodeEditor value={value} onChange={setValue} ownZoneId="own" />;
    }
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queries}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
    render(<Harness />, { wrapper: wrap });
    return { get };
  }

  it('pasted pincodes become chips; invalid ones are reported; one owned by another zone is flagged with its name', async () => {
    const user = userEvent.setup();
    setup({
      '600002': { id: 'other', name: 'Anna Nagar' },
      '600003': { id: 'own', name: 'This zone' },
    });
    await user.type(screen.getByLabelText('Add individual pincodes'), '600001, 600002 600003 12ab');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const chips = screen.getByRole('list', { name: 'Individual pincodes' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/Not valid pincodes, left out: 12ab/)).toBeTruthy();
    expect(await within(chips).findByText('in Anna Nagar')).toBeTruthy();
    // its own pincode is not a conflict
    expect(within(chips).queryByText('in This zone')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove 600002' }));
    expect(within(chips).getAllByRole('listitem')).toHaveLength(2);
  });

  it('a range over 2,000 pincodes says so before saving', async () => {
    const user = userEvent.setup();
    setup({});
    await user.type(screen.getByLabelText('Range from'), '600000');
    await user.type(screen.getByLabelText('Range to'), '603000');
    expect(screen.getByText(/at most 2,000 pincodes \(this one has 3,001\)/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Range to'));
    await user.type(screen.getByLabelText('Range to'), '600099');
    expect(screen.getByText('100 pincodes in this range.')).toBeTruthy();
  });
});
