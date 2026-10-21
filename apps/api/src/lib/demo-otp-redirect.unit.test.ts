import { describe, expect, it } from 'vitest';
import type { AuthMailer } from '../modules/auth/auth.mails';
import { noopAuthMailer } from '../modules/auth/auth.mails';
import { parseOtpRedirect, withDemoOtpRedirect } from './demo-otp-redirect';
import { loadEnv } from './env';

type Otp = Parameters<AuthMailer['sendOtpCode']>[0];
const otp = (to: string): Otp => ({
  to,
  name: 'Demo',
  code: '123456',
  expiresAt: new Date('2026-10-22T10:00:00Z'),
  purpose: 'LOGIN',
});

function recorder() {
  const sent: Otp[] = [];
  const mailer: AuthMailer = {
    ...noopAuthMailer,
    sendOtpCode: async (m) => {
      sent.push(m);
    },
  };
  return { sent, mailer };
}

describe('parseOtpRedirect', () => {
  it('reads login=inbox pairs, lowercased, separated by commas or semicolons', () => {
    const m = parseOtpRedirect(
      ' Boss@Demo.test = Owner@Example.test ; ops@demo.test=ops@example.test,',
    );
    expect([...m]).toEqual([
      ['boss@demo.test', 'owner@example.test'],
      ['ops@demo.test', 'ops@example.test'],
    ]);
  });

  it('refuses anything that is not email=email, and an empty map', () => {
    for (const bad of [
      'boss@demo.test',
      '=owner@example.test',
      'boss=owner@example.test',
      'a@b.c=nope',
      '',
      ' ; ',
    ]) {
      expect(() => parseOtpRedirect(bad)).toThrow(/DEMO_OTP_REDIRECT/);
    }
  });
});

describe('withDemoOtpRedirect', () => {
  const map = parseOtpRedirect(
    'boss@demo.test=owner@example.test,lead@demo.test=team@example.test',
  );

  it('sends the normal code mail unchanged AND a copy to the mapped inbox', async () => {
    const base = recorder();
    const copy = recorder();
    const mailer = withDemoOtpRedirect(base.mailer, copy.mailer, map);
    await mailer.sendOtpCode(otp('Boss@demo.test'));
    expect(base.sent).toEqual([otp('Boss@demo.test')]);
    expect(copy.sent).toEqual([{ ...otp('Boss@demo.test'), to: 'owner@example.test' }]);
  });

  it('an unmapped login gets only the normal mail', async () => {
    const base = recorder();
    const copy = recorder();
    await withDemoOtpRedirect(base.mailer, copy.mailer, map).sendOtpCode(otp('stranger@demo.test'));
    expect(base.sent).toHaveLength(1);
    expect(copy.sent).toHaveLength(0);
  });

  it('a failed copy never fails the sign-in and logs no address or code', async () => {
    const base = recorder();
    const errors: unknown[] = [];
    const broken: Pick<AuthMailer, 'sendOtpCode'> = {
      sendOtpCode: async () => {
        throw new TypeError('smtp down');
      },
    };
    const mailer = withDemoOtpRedirect(base.mailer, broken, map, (e) => errors.push(e));
    await expect(mailer.sendOtpCode(otp('lead@demo.test'))).resolves.toBeUndefined();
    expect(base.sent).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('every other mail is the base mailer itself', () => {
    const base = recorder();
    const mailer = withDemoOtpRedirect(base.mailer, recorder().mailer, map);
    expect(mailer.sendPasswordReset).toBe(base.mailer.sendPasswordReset);
    expect(mailer.sendNewLogin).toBe(base.mailer.sendNewLogin);
  });
});

describe('env guards (DEMO_MODE, DEMO_OTP_REDIRECT, DEMO_OTP_SMTP_URL)', () => {
  const valid = {
    APP_URL: 'http://127.0.0.1:3100',
    DATABASE_URL: 'postgresql://zoauro_app:x@127.0.0.1:5441/zoauro_demo',
    REDIS_URL: 'redis://127.0.0.1:6390/1',
    SESSION_SECRET: 's'.repeat(32),
    ENCRYPTION_KEY: 'e'.repeat(32),
    OTP_HMAC_KEY: 'o'.repeat(32),
    S3_BUCKET: 'zoauro-demo',
    S3_REGION: 'ap-south-1',
  };
  const demo = {
    DEMO_MODE: 'true',
    DEMO_OTP_REDIRECT: 'boss@demo.test=owner@example.test',
    DEMO_OTP_SMTP_URL: 'smtps://user:pass@smtp.example.test:465',
  };

  it('accepts the redirect with DEMO_MODE=true outside production', () => {
    const env = loadEnv({ ...valid, ...demo });
    expect(env.DEMO_MODE).toBe(true);
    expect(env.DEMO_OTP_REDIRECT?.get('boss@demo.test')).toBe('owner@example.test');
  });

  it('refuses the redirect without DEMO_MODE=true, or without its SMTP URL', () => {
    expect(() => loadEnv({ ...valid, ...demo, DEMO_MODE: 'false' })).toThrow(/DEMO_OTP_REDIRECT/);
    expect(() => loadEnv({ ...valid, DEMO_OTP_REDIRECT: demo.DEMO_OTP_REDIRECT })).toThrow(
      /DEMO_OTP_REDIRECT/,
    );
    expect(() =>
      loadEnv({ ...valid, DEMO_MODE: 'true', DEMO_OTP_REDIRECT: demo.DEMO_OTP_REDIRECT }),
    ).toThrow(/DEMO_OTP_SMTP_URL/);
  });

  it('refuses every DEMO_ setting in production', () => {
    expect(() => loadEnv({ ...valid, ...demo, NODE_ENV: 'production' })).toThrow(/DEMO_MODE/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(
      /DEMO_MODE/,
    );
  });

  it('is off by default', () => {
    const env = loadEnv(valid);
    expect(env.DEMO_MODE).toBe(false);
    expect(env.DEMO_OTP_REDIRECT).toBeUndefined();
  });
});
