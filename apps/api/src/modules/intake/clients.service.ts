import { randomBytes } from 'node:crypto';
import { INTAKE_SCOPES } from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import type { SecretBox } from '../auth/mfa/secret-box';
import type { IntakeDatabase } from './intake.repository';
import { apiClientSecretAad } from './intake.middleware';

// API clients for the apps (doc 42 section 1, doc 45). IH-1 creates them from the server CLI (`client:create`), so app
// teams get sandbox credentials before the Integration Hub screens exist. The secret is returned once and never again;
// only its sealed form is stored.

export type ApiClientKind = keyof typeof INTAKE_SCOPES;
export type ApiEnvironmentName = 'SANDBOX' | 'PRODUCTION';

/** Doc 42 section 3: 600 requests a minute per client. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 600;

export class ClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientInputError';
  }
}

export interface NewClient {
  name: string;
  type: ApiClientKind;
  environment: ApiEnvironmentName;
  /** default: every scope of the type (doc 42 section 2); otherwise a subset of them */
  scopes?: readonly string[];
  ipAllowlist?: readonly string[];
  rateLimitPerMin?: number;
}

export interface CreatedClient {
  id: string;
  keyId: string;
  /** shown once */
  secret: string;
  scopes: readonly string[];
}

export function validateNewClient(c: NewClient): Required<NewClient> {
  const name = c.name.trim();
  if (name.length < 2 || name.length > 80) throw new ClientInputError('name: 2 to 80 characters');
  const allowed: readonly string[] = INTAKE_SCOPES[c.type];
  const scopes = c.scopes ?? allowed;
  const unknown = scopes.filter((s) => !allowed.includes(s));
  if (unknown.length > 0)
    throw new ClientInputError(`not scopes of ${c.type}: ${unknown.join(', ')}`);
  if (scopes.length === 0) throw new ClientInputError('at least one scope');
  const rate = c.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
  if (!Number.isInteger(rate) || rate < 1 || rate > 100_000)
    throw new ClientInputError('rate limit: a whole number from 1 to 100000 a minute');
  const ips = c.ipAllowlist ?? [];
  for (const ip of ips) {
    if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw new ClientInputError(`not an IP address: ${ip}`);
  }
  return {
    name,
    type: c.type,
    environment: c.environment,
    scopes: [...new Set(scopes)],
    ipAllowlist: ips,
    rateLimitPerMin: rate,
  };
}

/** The key id says which environment it is for, so a sandbox key pasted into production config is obvious. */
export function newKeyId(environment: ApiEnvironmentName): string {
  return `zk_${environment === 'PRODUCTION' ? 'live' : 'test'}_${randomBytes(9).toString('base64url')}`;
}

export async function createApiClient(
  deps: { db: IntakeDatabase; secretBox: SecretBox; createdBy: string | null },
  input: NewClient,
): Promise<CreatedClient> {
  const c = validateNewClient(input);
  const id = uuidv7();
  const secretId = uuidv7();
  const keyId = newKeyId(c.environment);
  const secret = randomBytes(32).toString('base64url');
  await deps.db.transaction(async (tx) => {
    await tx.repo.createClient({
      id,
      name: c.name,
      type: c.type,
      environment: c.environment,
      keyId,
      scopes: c.scopes,
      ipAllowlist: c.ipAllowlist,
      rateLimitPerMin: c.rateLimitPerMin,
      secretId,
      secretEncrypted: deps.secretBox.seal(secret, apiClientSecretAad(secretId)),
      createdBy: deps.createdBy,
    });
    await record(tx.audit, {
      module: 'integrations',
      action: 'integration_client.created',
      entity: { type: 'integration_client', id, label: c.name, zoneId: null },
      // never the secret; the key id is not a secret
      after: {
        type: c.type,
        environment: c.environment,
        keyId,
        scopes: c.scopes,
        ipAllowlist: c.ipAllowlist,
        rateLimitPerMin: c.rateLimitPerMin,
      },
    });
  });
  return { id, keyId, secret, scopes: c.scopes };
}
