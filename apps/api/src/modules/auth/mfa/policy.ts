import {
  DEFAULT_SECURITY_POLICY,
  mfaPolicySchema,
  type MfaPolicy,
  type MfaType,
  type Role,
} from '@zoauro/shared';

// The 2-step policy (doc 52 section 5) from the settings key `security.mfa`, with the doc 52 defaults when the row is
// missing or invalid. The settings module (and its PUT /settings/security) does not exist yet (P10): this is only the
// reader, cached for at most 60 s like every setting (doc 12 "cached 60 s").

export const MFA_POLICY_SETTING_KEY = 'security.mfa';
const CACHE_MS = 60_000;

export interface MfaPolicyReader {
  read(): Promise<MfaPolicy>;
}

/** What a role may use right now: the allowed list, minus SMS while SMS is switched off (doc 52 section 5). */
export function usableMethodsFor(policy: MfaPolicy, role: Role): MfaType[] {
  return policy.allowed[role].filter((t) => t !== 'SMS_OTP' || policy.smsEnabled);
}

export const isMfaRequired = (policy: MfaPolicy, role: Role): boolean => policy.required[role];

export function createMfaPolicyReader(deps: {
  load: (key: string) => Promise<unknown>;
  now?: () => number;
  /** an invalid stored value is reported once per load (class name only) and the defaults apply */
  onInvalid?: () => void;
}): MfaPolicyReader & { invalidate(): void } {
  const now = deps.now ?? Date.now;
  let cached: { at: number; policy: MfaPolicy } | null = null;
  return {
    invalidate() {
      cached = null;
    },
    async read() {
      if (cached && now() - cached.at < CACHE_MS) return cached.policy;
      const raw = await deps.load(MFA_POLICY_SETTING_KEY);
      let policy = DEFAULT_SECURITY_POLICY.mfa;
      if (raw !== null && raw !== undefined) {
        const parsed = mfaPolicySchema.safeParse(raw);
        if (parsed.success) policy = parsed.data;
        else deps.onInvalid?.();
      }
      cached = { at: now(), policy };
      return policy;
    },
  };
}

/** A fixed policy (tests, and the defaults when nothing is stored). */
export const staticMfaPolicy = (policy: MfaPolicy): MfaPolicyReader => ({
  read: async () => policy,
});
