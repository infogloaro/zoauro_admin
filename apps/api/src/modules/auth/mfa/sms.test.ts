import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleSmsProvider,
  Msg91SmsProvider,
  SmsDeliveryError,
  SmsUnavailableError,
  createSmsProvider,
  disabledSmsProvider,
  smsEnablementProblem,
} from './sms';

// P9 (doc 56) / doc 52 sections 5 and 6: SMS behind a provider interface, off by default; MSG91 is the real one (D68).

const otp = { code: '123456', minutes: 5 };

describe('SMS providers', () => {
  it('none: cannot send and fails closed', async () => {
    expect(createSmsProvider({ SMS_PROVIDER: 'none' })).toBe(disabledSmsProvider);
    expect(disabledSmsProvider.canSend).toBe(false);
    await expect(disabledSmsProvider.sendOtp('+919876543210', otp)).rejects.toBeInstanceOf(
      SmsUnavailableError,
    );
  });

  it('console: keeps the DLT wording in memory (and prints only when asked)', async () => {
    const p = new ConsoleSmsProvider();
    await p.sendOtp('+919876543210', otp);
    expect(p.sent).toEqual([
      {
        to: '+919876543210',
        body: '123456 is your ZOAURO Admin verification code. It expires in 5 minutes. Never share it.',
      },
    ]);
  });

  it('msg91 without its key or template id fails closed', () => {
    expect(createSmsProvider({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k' })).toBe(
      disabledSmsProvider,
    );
    expect(
      createSmsProvider({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k', SMS_TEMPLATE_ID_OTP: 't' }),
    ).toBeInstanceOf(Msg91SmsProvider);
  });
});

describe('MSG91 flow API', () => {
  const ok = () => new Response(JSON.stringify({ type: 'success' }), { status: 200 });

  it('posts the template id, the number without + and the variables, with the auth key header', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ok());
    await new Msg91SmsProvider({ authKey: 'KEY', templateId: 'TPL', fetch: fetchMock }).sendOtp(
      '+919876543210',
      otp,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://control.msg91.com/api/v5/flow');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ authkey: 'KEY', 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      template_id: 'TPL',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', otp: '123456', minutes: '5' }],
    });
  });

  it('an HTTP error or a 200 with type=error is a delivery failure', async () => {
    const http = new Msg91SmsProvider({
      authKey: 'K',
      templateId: 'T',
      fetch: async () => new Response('no', { status: 401 }),
    });
    await expect(http.sendOtp('+919876543210', otp)).rejects.toBeInstanceOf(SmsDeliveryError);
    const soft = new Msg91SmsProvider({
      authKey: 'K',
      templateId: 'T',
      fetch: async () =>
        new Response(JSON.stringify({ type: 'error', message: 'x' }), { status: 200 }),
    });
    await expect(soft.sendOtp('+919876543210', otp)).rejects.toBeInstanceOf(SmsDeliveryError);
  });

  it('the error message never carries the number or the code', async () => {
    const p = new Msg91SmsProvider({
      authKey: 'K',
      templateId: 'T',
      fetch: async () => new Response('', { status: 500 }),
    });
    const err = await p.sendOtp('+919876543210', otp).catch((e: unknown) => e);
    expect(String(err)).not.toMatch(/9876543210|123456/);
  });
});

describe('the policy may switch SMS on only with a real provider and the DLT template (doc 52 section 5)', () => {
  it('none and console are never enough', () => {
    expect(smsEnablementProblem({ SMS_PROVIDER: 'none' })).not.toBeNull();
    expect(
      smsEnablementProblem({ SMS_PROVIDER: 'console', SMS_DLT_TEMPLATE_ID_OTP: 'T1' }),
    ).not.toBeNull();
  });

  it('msg91 needs the DLT template id too', () => {
    expect(smsEnablementProblem({ SMS_PROVIDER: 'msg91' })).toBe(
      'SMS_DLT_TEMPLATE_ID_OTP is not set',
    );
    expect(
      smsEnablementProblem({ SMS_PROVIDER: 'msg91', SMS_DLT_TEMPLATE_ID_OTP: 'T1' }),
    ).toBeNull();
  });
});
