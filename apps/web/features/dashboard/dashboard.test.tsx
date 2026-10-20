import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SECURITY_POLICY, type MeZone } from '@zoauro/shared';
import { matchPages } from '../../components/shell/PageSearch';
import { initialsOf } from '../../components/shell/UserMenu';
import { menuFor } from '../../lib/navigation';
import { tightens } from '../settings/SecuritySettings';
import { greeting, relativeTime } from './time';
import { ZonalDashboard, groupPermissions } from './ZonalDashboard';

// Theme and dashboards (owner's prototype + roadmap): the pure helpers and the Zonal dashboard built from /me.

const zone = (permissions: MeZone['permissions'], perRefund = 0): MeZone => ({
  zoneId: '0192f1d2-0000-7000-8000-000000000001',
  name: 'Anna Nagar',
  code: 'ANN',
  colorHex: '#F97316',
  status: 'ACTIVE',
  permissions,
  limits: { perRefund, dailyRefund: perRefund * 5, canReveal: false, canExport: true },
});

describe('page finder', () => {
  const menu = menuFor('SUPER_ADMIN', []);
  it('matches labels case-insensitively, prefix matches and live pages first, at most 8', () => {
    expect(matchPages(menu, '')).toEqual([]);
    expect(matchPages(menu, 'zone')[0]?.label).toBe('Zone Management');
    expect(matchPages(menu, 'SECUR').map((m) => m.label)).toEqual([
      'Security Settings',
      'Account security',
    ]);
    expect(matchPages(menu, 'e').length).toBeLessThanOrEqual(8);
  });
  it('a Zonal Admin never finds a page outside their menu', () => {
    expect(matchPages(menuFor('ZONAL_ADMIN', []), 'zone')).toEqual([]);
  });
});

describe('security policy', () => {
  const base = DEFAULT_SECURITY_POLICY.mfa;
  it('requiring 2-step for Zonal Admins, switching SMS off or removing a method tightens; adding one does not', () => {
    expect(tightens({ ...base, required: { SUPER_ADMIN: true, ZONAL_ADMIN: false } }, base)).toBe(
      true,
    );
    expect(
      tightens(base, { ...base, allowed: { ...base.allowed, ZONAL_ADMIN: ['AUTHENTICATOR'] } }),
    ).toBe(true);
    expect(
      tightens({ ...base, allowed: { ...base.allowed, ZONAL_ADMIN: ['AUTHENTICATOR'] } }, base),
    ).toBe(false);
    expect(tightens({ ...base, smsEnabled: true }, base)).toBe(true);
    expect(tightens(base, { ...base, otpTtlSeconds: 240 })).toBe(false);
  });
});

describe('helpers', () => {
  it('initials, greeting and relative time', () => {
    expect(initialsOf('Asha Rao')).toBe('AR');
    expect(initialsOf('  priya  ')).toBe('P');
    expect(initialsOf('Arun Kumar Raj')).toBe('AR');
    expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(greeting());
    const now = new Date('2026-10-13T10:00:00Z');
    expect(relativeTime('2026-10-13T09:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-10-13T09:52:00Z', now)).toBe('8 minutes ago');
    expect(relativeTime('2026-10-12T10:00:00Z', now)).toBe('yesterday');
  });

  it('permission keys group by module, actions in order given', () => {
    expect(groupPermissions(['orders:view', 'orders:status', 'customers:view', 'bad'])).toEqual([
      ['customers', ['view']],
      ['orders', ['view', 'status']],
    ]);
  });
});

describe('Zonal dashboard', () => {
  it('shows each zone with its permissions and limits, and only the modules this member can open', () => {
    const html = renderToStaticMarkup(
      <ZonalDashboard name="Riya Sharma" zones={[zone(['orders:view', 'orders:edit'], 100_000)]} />,
    );
    expect(html).toContain('Riya');
    expect(html).toContain('Anna Nagar');
    expect(html).toContain('₹1,000');
    expect(html).toContain('Orders');
    expect(html).not.toContain('Zone Management');
    expect(html).not.toContain('Restaurants'); // no restaurants:view in any zone
  });

  it('a zone without permissions says to ask a Super Admin', () => {
    const html = renderToStaticMarkup(<ZonalDashboard name="Riya" zones={[zone([])]} />);
    expect(html).toContain('Ask a Super Admin');
  });
});
