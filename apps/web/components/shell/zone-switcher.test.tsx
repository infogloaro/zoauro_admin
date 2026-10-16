// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { canSwitch, scopeLabel, selectedZone, withZone } from '../../lib/zone-scope';
import { ZoneSwitcher } from './ZoneSwitcher';

// Zone scope switcher (M05, owner's spec 2.11, D116): ?zone=<CODE> in the URL, remembered with PUT /me/zone-scope,
// a view filter only. A Zonal Admin chooses among their own zones; a code they may not use falls back to "all".

const A = {
  id: '0192f1d2-0000-7000-8000-00000000000a',
  name: 'Anna Nagar',
  code: 'ANN',
  colorHex: '#EA580C',
};
const B = {
  id: '0192f1d2-0000-7000-8000-00000000000b',
  name: 'Adyar',
  code: 'ADY',
  colorHex: '#2563EB',
};

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/zone/dashboard',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace }),
}));

afterEach(cleanup);
beforeEach(() => {
  nav.search = '';
  nav.replace.mockReset();
});

describe('zone scope helpers', () => {
  it('a code selects one of the given zones, case-insensitively; any other code means all', () => {
    expect(selectedZone('ann', [A, B])).toBe(A);
    expect(selectedZone('XYZ', [A, B])).toBeNull();
    expect(selectedZone(null, [A, B])).toBeNull();
  });
  it('labels and when there is anything to switch', () => {
    expect(scopeLabel('ZONAL_ADMIN', null, [A, B])).toBe('All my zones');
    expect(scopeLabel('ZONAL_ADMIN', null, [A])).toBe('Anna Nagar');
    expect(scopeLabel('ZONAL_ADMIN', null, [])).toBe('No zones');
    expect(scopeLabel('SUPER_ADMIN', null, [])).toBe('All zones');
    expect(scopeLabel('SUPER_ADMIN', B, [A, B])).toBe('Adyar');
    expect(canSwitch('ZONAL_ADMIN', [A])).toBe(false);
    expect(canSwitch('ZONAL_ADMIN', [A, B])).toBe(true);
    expect(canSwitch('SUPER_ADMIN', [])).toBe(true);
  });
  it('keeps the other parameters of the URL', () => {
    expect(withZone('status=ACTIVE', 'ANN')).toBe('status=ACTIVE&zone=ANN');
    expect(withZone('status=ACTIVE&zone=ANN', null)).toBe('status=ACTIVE');
  });
});

const ZONAL = 'ZONAL_ADMIN' as const;

function mount(props: { zones: (typeof A)[]; savedZoneId?: string | null }) {
  const put = vi.fn(async () => ({ zoneIds: [] }));
  const client = { put, get: vi.fn() } as unknown as ApiClient;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiClientProvider client={client}>
        <ZoneSwitcher role={ZONAL} zones={props.zones} savedZoneId={props.savedZoneId ?? null} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { put };
}

describe('ZoneSwitcher (Zonal Admin)', () => {
  it('choosing a zone puts its code in the URL and remembers it; "all" removes it', async () => {
    const user = userEvent.setup();
    const { put } = mount({ zones: [A, B] });
    await user.click(screen.getByRole('button', { name: /Zone shown:\s*All my zones/ }));
    await user.click(screen.getByRole('button', { name: /Adyar/ }));
    expect(nav.replace).toHaveBeenLastCalledWith('/zone/dashboard?zone=ADY', { scroll: false });
    expect(put).toHaveBeenCalledWith('/me/zone-scope', { body: { zoneIds: [B.id] } });
  });

  it('only their own zones are offered', async () => {
    const user = userEvent.setup();
    mount({ zones: [A, B] });
    await user.click(screen.getByRole('button', { name: /Zone shown/ }));
    const names = screen.getByRole('list', { name: 'Choose the zone to show' }).textContent ?? '';
    expect(names).toContain('Anna Nagar');
    expect(names).toContain('Adyar');
    expect(names).toContain('All my zones');
  });

  it('a code from an unassigned zone is dropped from the URL', async () => {
    nav.search = 'zone=XYZ';
    mount({ zones: [A, B] });
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/zone/dashboard', { scroll: false }),
    );
    expect(screen.getByRole('button', { name: /Zone shown:\s*All my zones/ })).toBeTruthy();
  });

  it('the remembered zone applies when the URL names none', async () => {
    mount({ zones: [A, B], savedZoneId: A.id });
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/zone/dashboard?zone=ANN', { scroll: false }),
    );
  });

  it('one zone: nothing to switch, the zone is shown', () => {
    mount({ zones: [A] });
    expect(screen.queryByRole('button', { name: /Zone shown/ })).toBeNull();
    expect(screen.getByText('Anna Nagar')).toBeTruthy();
  });
});
