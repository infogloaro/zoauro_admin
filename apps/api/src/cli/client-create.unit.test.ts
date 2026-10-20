import { describe, expect, it } from 'vitest';
import { validateNewClient, newKeyId } from '../modules/intake/clients.service';
import { parseClientCreateArgs } from './client-create';

describe('client:create arguments (IH-1)', () => {
  it('parses type, environment, name and the optional lists', () => {
    expect(
      parseClientCreateArgs([
        '--type',
        'VENDOR_APP',
        '--env',
        'SANDBOX',
        '--name',
        'Vendor app sandbox',
        '--scopes',
        'vendors:register, menu:write',
        '--ip',
        '203.0.113.7',
        '--rate',
        '300',
      ]),
    ).toEqual({
      name: 'Vendor app sandbox',
      type: 'VENDOR_APP',
      environment: 'SANDBOX',
      scopes: ['vendors:register', 'menu:write'],
      ipAllowlist: ['203.0.113.7'],
      rateLimitPerMin: 300,
    });
  });

  it('refuses a missing or unknown type, environment or name, and a non-numeric rate', () => {
    const base = ['--type', 'PARTNER_APP', '--env', 'PRODUCTION', '--name', 'Partner app'];
    expect(() => parseClientCreateArgs(base)).not.toThrow();
    for (const bad of [
      ['--env', 'SANDBOX', '--name', 'x'],
      ['--type', 'ADMIN_APP', '--env', 'SANDBOX', '--name', 'x'],
      ['--type', 'VENDOR_APP', '--env', 'STAGING', '--name', 'x'],
      ['--type', 'VENDOR_APP', '--env', 'SANDBOX'],
      [...base, '--rate', '10/min'],
    ]) {
      expect(() => parseClientCreateArgs(bad)).toThrow();
    }
  });
});

describe('validateNewClient (doc 42 section 2)', () => {
  it('defaults to every scope of the type and 600 a minute', () => {
    const c = validateNewClient({
      name: ' Customer app ',
      type: 'CUSTOMER_APP',
      environment: 'SANDBOX',
    });
    expect(c.name).toBe('Customer app');
    expect(c.scopes).toContain('orders:create');
    expect(c.scopes).not.toContain('vendors:register');
    expect(c.rateLimitPerMin).toBe(600);
  });

  it('refuses a scope of another app type, an empty scope list and a bad IP', () => {
    expect(() =>
      validateNewClient({
        name: 'Vendor',
        type: 'VENDOR_APP',
        environment: 'SANDBOX',
        scopes: ['orders:create'],
      }),
    ).toThrow(/not scopes of VENDOR_APP: orders:create/);
    expect(() =>
      validateNewClient({ name: 'Vendor', type: 'VENDOR_APP', environment: 'SANDBOX', scopes: [] }),
    ).toThrow();
    expect(() =>
      validateNewClient({
        name: 'Vendor',
        type: 'VENDOR_APP',
        environment: 'SANDBOX',
        ipAllowlist: ['evil;rm'],
      }),
    ).toThrow(/not an IP/);
  });

  it('key ids show their environment', () => {
    expect(newKeyId('SANDBOX')).toMatch(/^zk_test_[A-Za-z0-9_-]{12}$/);
    expect(newKeyId('PRODUCTION')).toMatch(/^zk_live_[A-Za-z0-9_-]{12}$/);
  });
});
