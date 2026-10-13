import { describe, expect, it } from 'vitest';
import {
  ConsoleSmsProvider,
  SmsUnavailableError,
  createSmsProvider,
  disabledSmsProvider,
  smsEnablementProblem,
} from './sms';

// P9 (doc 56) / doc 52 sections 5 and 6: SMS is an interface only, off by default.

describe('SMS providers', () => {
  it('none: cannot send and fails closed', async () => {
    expect(createSmsProvider('none')).toBe(disabledSmsProvider);
    expect(disabledSmsProvider.canSend).toBe(false);
    await expect(disabledSmsProvider.send('+919876543210', 'x')).rejects.toBeInstanceOf(
      SmsUnavailableError,
    );
  });

  it('console: keeps messages in memory (and prints only when asked)', async () => {
    const p = new ConsoleSmsProvider();
    await p.send('+919876543210', 'hello');
    expect(p.sent).toEqual([{ to: '+919876543210', body: 'hello' }]);
  });
});

describe('the policy may switch SMS on only with a real provider and the DLT template (doc 52 section 5)', () => {
  it('none and console are never enough; nothing else exists yet (D68 open)', () => {
    expect(smsEnablementProblem({ SMS_PROVIDER: 'none' })).not.toBeNull();
    expect(
      smsEnablementProblem({ SMS_PROVIDER: 'console', SMS_DLT_TEMPLATE_ID_OTP: 'T1' }),
    ).not.toBeNull();
  });
});
