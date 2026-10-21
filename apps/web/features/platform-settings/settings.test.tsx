// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { settingDef } from '@zoauro/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { describeValue, formatMinutes, fromDraft, toDraft, validate } from './fields';
import { PlatformSettingsPage } from './PlatformSettingsPage';

// Platform settings (doc 59, D109–D116): the form model, the source and effect badges, and the change workflow
// edit → review (server preview) → reason → save. The re-auth itself is covered by the e2e flow.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => '/super-admin/settings/platform',
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/settings/platform'));

describe('settings form model', () => {
  it('money is typed in rupees and stored in paise; the registry schema validates', () => {
    const def = settingDef('refunds.limits');
    const draft = toDraft('refunds.limits', def?.default);
    expect(draft.fields['perRefundPaise']).toBe('1000');
    draft.fields['perRefundPaise'] = '2500.5';
    const value = fromDraft('refunds.limits', draft);
    expect(value).toMatchObject({ perRefundPaise: 250050, perDayPaise: 500000 });
    expect(validate('refunds.limits', value)).toEqual({});
    // the day cap cannot be lower than the per-refund cap (registry rule)
    draft.fields['perRefundPaise'] = '6000';
    expect(validate('refunds.limits', fromDraft('refunds.limits', draft))['perDayPaise']).toMatch(
      /day cap/,
    );
    draft.fields['perRefundPaise'] = '';
    expect(validate('refunds.limits', fromDraft('refunds.limits', draft))['perRefundPaise']).toBe(
      'Enter a value',
    );
  });

  it('a "not configured" setting stays null (loyalty D101); a hotel document list may be null (D145)', () => {
    expect(toDraft('loyalty.values', null).configured).toBe(false);
    expect(fromDraft('loyalty.values', toDraft('loyalty.values', null))).toBeNull();
    const docs = fromDraft(
      'onboarding.documents',
      toDraft('onboarding.documents', settingDef('onboarding.documents')?.default),
    );
    expect(docs).toMatchObject({
      HOTEL: null,
      RESTAURANT: [
        { code: 'FSSAI', mandatory: true },
        { code: 'GST', mandatory: true },
        { code: 'PAN', mandatory: true },
        { code: 'BANK_DETAILS', mandatory: true },
      ],
    });
    expect(validate('onboarding.documents', docs)).toEqual({});
    expect(describeValue('onboarding.documents', docs)[1]?.text).toContain('(optional)');
  });

  it('refund rules round-trip: reasons table, nested auto-approval, targets in their listed order (D146, D180)', () => {
    const def = settingDef('refunds.rules');
    const draft = toDraft('refunds.rules', def?.default);
    expect(draft.fields['autoApprove.maxAmountPaise']).toBe('200');
    expect(draft.fields['autoApprove.trusted.minDeliveredOrders']).toBe('5');
    expect(fromDraft('refunds.rules', draft)).toEqual(def?.default);
    // a new reason: the code is upper-cased; COD targets keep the listed order whatever order they were ticked in
    const rows = draft.fields['reasons'] as Record<string, string | boolean>[];
    draft.fields['reasons'] = [
      ...rows,
      { code: 'late_food', label: 'Food came late', bearer: 'VENDOR' },
    ];
    draft.fields['targets.COD'] = ['UPI', 'WALLET'];
    const value = fromDraft('refunds.rules', draft) as {
      reasons: { code: string }[];
      targets: { COD: string[] };
    };
    expect(value.reasons.at(-1)?.code).toBe('LATE_FOOD');
    expect(value.targets.COD).toEqual(['WALLET', 'UPI']);
    expect(validate('refunds.rules', value)).toEqual({});
    // errors land on the field, naming the row
    draft.fields['reasons'] = [...rows, { code: '', label: 'x', bearer: 'VENDOR' }];
    expect(validate('refunds.rules', fromDraft('refunds.rules', draft))['reasons']).toMatch(
      /^Row 11: /,
    );
    draft.fields['autoApprove.withinHoursOfDelivery'] = '0';
    expect(
      validate('refunds.rules', fromDraft('refunds.rules', draft))[
        'autoApprove.withinHoursOfDelivery'
      ],
    ).toBeTruthy();
    expect(describeValue('refunds.rules', def?.default)[0]?.text).toMatch(/^Wrong item \(Vendor\)/);
  });

  it('durations read as people say them', () => {
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(1440)).toBe('1 day');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(describeValue('support.sla', settingDef('support.sla')?.default)[0]).toEqual({
      label: 'First reply within',
      text: '2 h',
    });
  });
});

const view = (key: string, over: Record<string, unknown> = {}) => {
  const def = settingDef(key);
  if (!def) throw new Error(key);
  return {
    key,
    group: def.group,
    label: def.label,
    description: def.description,
    zoneOverride: def.zoneOverride,
    reauth: def.reauth,
    editable: def.editable,
    default: def.default,
    platform: null,
    zone: null,
    effective: def.default,
    source: 'DEFAULT',
    effect:
      def.effect.state === 'ENFORCED' ? { state: 'ENFORCED', module: null } : { ...def.effect },
    ...over,
  };
};

function setup() {
  const post = vi.fn(async (path: string, init?: { body?: unknown }) => {
    void init;
    if (path === '/settings/{group}/preview')
      return { zoneId: null, changes: [], membersAboveCap: [], orderNumberExample: null };
    throw new Error(`unexpected POST ${path}`);
  });
  const put = vi.fn(async (path: string, init?: { body?: unknown }) => {
    void path;
    void init;
    return { zoneId: null, data: [] };
  });
  const get = vi.fn(async (path: string) => {
    if (path === '/settings')
      return {
        zoneId: null,
        data: [
          view('refunds.limits'),
          view('refunds.rules'),
          view('support.sla', {
            source: 'PLATFORM',
            platform: {
              value: settingDef('support.sla')?.default,
              version: 3,
              updatedAt: new Date().toISOString(),
              updatedBy: { id: '0192f1d2-0000-7000-8000-0000000000a1', name: 'Asha Super' },
            },
          }),
          view('security.mfa'),
        ],
      };
    if (path === '/zones') return { data: [], meta: { nextCursor: null } };
    throw new Error(`unexpected GET ${path}`);
  });
  const client = { get, post, put } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  render(<PlatformSettingsPage />, { wrapper: wrap });
  return { post, put };
}

const row = async (name: string) => {
  const heading = await screen.findByRole('heading', { name, level: 3 });
  const section = heading.closest('section');
  if (!section) throw new Error('no row');
  return within(section);
};

describe('Platform Settings page', () => {
  it('shows where each value comes from and whether it works yet', async () => {
    setup();
    const limits = await row('Refund limits (zone caps)');
    expect(limits.getByText('Default rule')).toBeTruthy();
    expect(limits.getByText('Enforced')).toBeTruthy();
    expect(limits.getByText(/^₹1,000(\.00)?$/)).toBeTruthy();
    const rules = await row('Refund rules');
    // decided defaults now (D146, D180): the reasons with who pays
    expect(rules.getByText(/Wrong item \(Vendor\)/)).toBeTruthy();
    const sla = await row('Support response times');
    expect(sla.getByText('Set by Super Admin')).toBeTruthy();
    expect(sla.getByText('Applies when Support desk ships')).toBeTruthy();
    expect(sla.getByText(/Changed by Asha Super/)).toBeTruthy();
    expect(
      sla.getByRole('button', { name: 'Reset Support response times to the default' }),
    ).toBeTruthy();
    // the 2-step policy is changed on its own screen
    const mfa = await row('2-step verification policy');
    expect(mfa.getByRole('link', { name: /Security settings/ })).toBeTruthy();
    expect(mfa.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('edit → review (server preview) → reason → save sends the paise value and the reason', async () => {
    const user = userEvent.setup();
    const { post, put } = setup();
    const limits = await row('Refund limits (zone caps)');
    await user.click(limits.getByRole('button', { name: 'Edit Refund limits (zone caps)' }));
    const dialog = await screen.findByRole('dialog');
    const perRefund = within(dialog).getByLabelText('Per refund cap');
    await user.clear(perRefund);
    await user.type(perRefund, '2000');
    await user.click(within(dialog).getByRole('button', { name: /Review change/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]?.body).toEqual({
      values: {
        'refunds.limits': {
          perRefundPaise: 200000,
          perDayPaise: 500000,
          secondApproverAbovePaise: 1000000,
        },
      },
    });
    // before and after; Save waits for a reason
    expect(await within(dialog).findByText(/^₹2,000(\.00)?$/)).toBeTruthy();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      within(dialog).getByLabelText('Reason for the change'),
      'Higher cap for festival week',
    );
    await user.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]?.[0]).toBe('/settings/{group}');
    expect(put.mock.calls[0]?.[1]?.body).toMatchObject({
      reason: 'Higher cap for festival week',
      values: { 'refunds.limits': { perRefundPaise: 200000 } },
    });
    expect(await screen.findByText('Refund limits (zone caps) saved')).toBeTruthy();
  });

  it('an invalid value is caught before anything is sent', async () => {
    const user = userEvent.setup();
    const { post } = setup();
    const limits = await row('Refund limits (zone caps)');
    await user.click(limits.getByRole('button', { name: 'Edit Refund limits (zone caps)' }));
    const dialog = await screen.findByRole('dialog');
    const perDay = within(dialog).getByLabelText('Per day cap');
    await user.clear(perDay);
    await user.type(perDay, '10');
    await user.click(within(dialog).getByRole('button', { name: /Review change/ }));
    expect(await within(dialog).findByText(/day cap cannot be lower/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});
