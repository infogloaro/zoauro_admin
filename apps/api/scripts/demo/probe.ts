import { readFileSync } from 'node:fs';
import { DemoClient, type DemoAccount } from './client';

// Local probe: GET a path as a demo account against the running demo API. Not part of the seed.
//   tsx --env-file=.env.demo scripts/demo/probe.ts <accountKey> <path>

const [key = 'primary', path = '/me'] = process.argv.slice(2);
const file = process.env['DEMO_CREDENTIALS'] ?? '.env.demo-credentials.json';
const accounts = (
  JSON.parse(readFileSync(file, 'utf8')) as { accounts: Record<string, DemoAccount> }
).accounts;
const a = accounts[key];
if (!a) throw new Error(`no account ${key}`);
const c = new DemoClient(
  `http://127.0.0.1:${process.env['PORT'] ?? '4100'}/api/v1`,
  'http://127.0.0.1:3100',
  a,
);
await c.login();
const r = await c.raw('GET', path);
console.log(r.status, JSON.stringify(r.json).slice(0, 1500));
