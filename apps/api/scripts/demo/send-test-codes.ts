import { readFileSync } from 'node:fs';
import { DemoClient, type DemoAccount } from './client';

// Local check of the demo OTP copy: for each demo login, the password step and an email code request, exactly as the
// sign-in page does. The code goes to Mailpit as always and, with DEMO_OTP_REDIRECT, to the presenter's inbox too.
// Prints only the login and the HTTP status: never a code, a password or an inbox address.
//   tsx --env-file=.env.demo scripts/demo/send-test-codes.ts

const file = process.env['DEMO_CREDENTIALS'] ?? '.env.demo-credentials.json';
const accounts = (
  JSON.parse(readFileSync(file, 'utf8')) as { accounts: Record<string, DemoAccount> }
).accounts;
const base = `http://127.0.0.1:${process.env['PORT'] ?? '4100'}/api/v1`;

for (const a of Object.values(accounts)) {
  const c = new DemoClient(base, 'http://127.0.0.1:3100', a);
  const csrf = await c.raw('GET', '/auth/csrf');
  (c as unknown as { csrf: string }).csrf = (csrf.json as { token: string }).token;
  const login = await c.raw('POST', '/auth/login', {
    email: a.email,
    password: a.password,
    tab: a.role,
  });
  const status = (login.json as { status?: string } | null)?.status;
  if (status !== 'MFA_REQUIRED') {
    console.log(`${a.email}: login ${login.status} ${status ?? ''}`);
    continue;
  }
  const ch = await c.raw('POST', '/auth/mfa/challenge', { method: 'EMAIL_OTP' });
  console.log(`${a.email}: code requested -> ${ch.status}`);
}
