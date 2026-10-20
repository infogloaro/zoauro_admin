import { INTAKE_SCOPES } from '@zoauro/shared';
import type { ApiEnvironmentName, NewClient } from '../modules/intake/clients.service';
import { CliError } from './mfa-reset';

// `pnpm --filter @zoauro/api cli client:create --type VENDOR_APP --env SANDBOX --name "Vendor app sandbox"
//   [--scopes a,b] [--ip 203.0.113.7,198.51.100.2] [--rate 600]`
// IH-1 (doc 34): API client credentials for an app team before the Integration Hub screens exist. Audited as SYSTEM
// with the operator's OS user. Prints the key id and the secret ONCE; only the sealed secret is stored.

export const CLIENT_CREATE_USAGE =
  'usage: cli client:create --type CUSTOMER_APP|VENDOR_APP|PARTNER_APP --env SANDBOX|PRODUCTION --name "<name>" [--scopes a,b] [--ip a,b] [--rate 600]';

export function parseClientCreateArgs(argv: readonly string[]): NewClient {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (flag: string): string[] | undefined =>
    value(flag)
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const type = value('--type');
  if (!type || !(type in INTAKE_SCOPES)) throw new CliError(CLIENT_CREATE_USAGE);
  const env = value('--env');
  if (env !== 'SANDBOX' && env !== 'PRODUCTION') throw new CliError(CLIENT_CREATE_USAGE);
  const name = value('--name');
  if (!name) throw new CliError(CLIENT_CREATE_USAGE);
  const rate = value('--rate');
  if (rate !== undefined && !/^\d+$/.test(rate)) throw new CliError('--rate: a whole number');

  const scopes = list('--scopes');
  const ips = list('--ip');
  return {
    name,
    type: type as keyof typeof INTAKE_SCOPES,
    environment: env satisfies ApiEnvironmentName,
    ...(scopes ? { scopes } : {}),
    ...(ips ? { ipAllowlist: ips } : {}),
    ...(rate !== undefined ? { rateLimitPerMin: Number(rate) } : {}),
  };
}
