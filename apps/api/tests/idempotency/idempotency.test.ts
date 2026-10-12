import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors';
import {
  IDEMPOTENCY_TTL_MS,
  IN_PROGRESS_TIMEOUT_MS,
  IdempotencyRepository,
  canonicalJson,
  idempotency,
  requestFingerprint,
} from '../../src/lib/idempotency';
import { requireSession } from '../../src/lib/auth/middleware';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';

let env: AuthTestEnv;
let app: ReturnType<AuthTestEnv['makeAuthzApp']>['app'];
let repo: IdempotencyRepository;

const executions = { refund: 0, slow: 0, failing: 0, noContent: 0 };
let releaseSlow: () => void = () => undefined;

beforeAll(async () => {
  env = await createAuthTestEnv();
  repo = new IdempotencyRepository(env.prisma);
  const guard = idempotency({ store: repo, clock: env.clock.now });

  const router = Router();
  router.post('/_t/refunds', requireSession(), guard, (req, res) => {
    executions.refund += 1;
    res.status(201).json({ refundId: `r-${executions.refund}`, amount: req.body?.amount ?? null });
  });
  router.post('/_t/slow', requireSession(), guard, async (_req, res) => {
    executions.slow += 1;
    await new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    res.json({ done: true });
  });
  router.post('/_t/failing', requireSession(), guard, (req, res) => {
    executions.failing += 1;
    if (req.body?.amount > 100) throw new AppError('REFUND_LIMIT_EXCEEDED', 'Over the limit');
    res.status(201).json({ ok: true, attempt: executions.failing });
  });
  router.post('/_t/crash', requireSession(), guard, () => {
    throw new Error('boom');
  });
  router.post('/_t/no-content', requireSession(), guard, (_req, res) => {
    executions.noContent += 1;
    res.status(204).end();
  });
  // These stand-in routes test idempotency only and write no audit rows; the coverage guard has its own tests.
  ({ app } = env.makeAuthzApp({ routers: [router], auditCoverage: { mode: 'collect' } }));
}, 120_000);

afterAll(async () => {
  await env.close();
});

const post = (path: string, cookie: string, key: string | null, body: object = {}) => {
  const r = request(app).post(`/api/v1${path}`).set('Cookie', cookie);
  if (key !== null) r.set('Idempotency-Key', key);
  return r.send(body);
};
const cookieFor = async () => (await env.session(await env.createUser('ZONAL_ADMIN'))).cookie;
/** The clock jumps hours in the retention tests; a session idles out after 30 minutes, so sign in again. */
const freshCookie = async (user: Awaited<ReturnType<AuthTestEnv['createUser']>>) =>
  (await env.session(user)).cookie;

describe('Idempotency-Key header', () => {
  it('is required: 422 VALIDATION_ERROR naming the header, and the handler does not run', async () => {
    const before = executions.refund;
    const res = await post('/_t/refunds', await cookieFor(), null, { amount: 500 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'Idempotency-Key', issue: 'required' }],
    });
    expect(executions.refund).toBe(before);
  });

  it('must look like a key (8-128 characters of [A-Za-z0-9_.:-])', async () => {
    const cookie = await cookieFor();
    for (const bad of ['short', 'has spaces in it!', 'x'.repeat(129)]) {
      const res = await post('/_t/refunds', cookie, bad);
      expect(res.status, bad).toBe(422);
    }
  });
});

describe('replay', () => {
  it('runs the handler once and replays the stored status and body for the same key and request', async () => {
    const cookie = await cookieFor();
    const before = executions.refund;
    const first = await post('/_t/refunds', cookie, 'refund-key-0001', { amount: 500 });
    const second = await post('/_t/refunds', cookie, 'refund-key-0001', { amount: 500 });
    const third = await post('/_t/refunds', cookie, 'refund-key-0001', { amount: 500 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(executions.refund).toBe(before + 1);
  });

  it('treats the same JSON with keys in another order as the same request', async () => {
    const cookie = await cookieFor();
    const before = executions.refund;
    await post('/_t/refunds', cookie, 'refund-key-order', { amount: 1, note: 'a' });
    const again = await post('/_t/refunds', cookie, 'refund-key-order', { note: 'a', amount: 1 });
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(executions.refund).toBe(before + 1);
  });

  it('replays an empty 204 response too', async () => {
    const cookie = await cookieFor();
    const before = executions.noContent;
    const first = await post('/_t/no-content', cookie, 'nocontent-key-1');
    const second = await post('/_t/no-content', cookie, 'nocontent-key-1');
    expect([first.status, second.status]).toEqual([204, 204]);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(executions.noContent).toBe(before + 1);
  });
});

describe('the request hash', () => {
  it('rejects the same key with a different body (422) without running the handler', async () => {
    const cookie = await cookieFor();
    await post('/_t/refunds', cookie, 'refund-key-hash', { amount: 500 });
    const before = executions.refund;
    const res = await post('/_t/refunds', cookie, 'refund-key-hash', { amount: 900 });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toEqual({ field: 'Idempotency-Key', issue: 'reused' });
    expect(executions.refund).toBe(before);
  });

  it('rejects the same key on a different route', async () => {
    const cookie = await cookieFor();
    await post('/_t/refunds', cookie, 'refund-key-route', {});
    const res = await post('/_t/failing', cookie, 'refund-key-route', {});
    expect(res.status).toBe(422);
  });

  it('fingerprint is stable and sensitive', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(requestFingerprint('post', '/x', { a: 1 })).toBe(
      requestFingerprint('POST', '/x', { a: 1 }),
    );
    expect(requestFingerprint('POST', '/x', { a: 1 })).not.toBe(
      requestFingerprint('POST', '/x', { a: 2 }),
    );
    expect(requestFingerprint('POST', '/x', { a: 1 })).not.toBe(
      requestFingerprint('POST', '/y', { a: 1 }),
    );
  });
});

describe('who owns a key', () => {
  it("two users can use the same key independently and never see each other's response", async () => {
    const a = await cookieFor();
    const b = await cookieFor();
    const before = executions.refund;
    const ra = await post('/_t/refunds', a, 'shared-key-0001', { amount: 1 });
    const rb = await post('/_t/refunds', b, 'shared-key-0001', { amount: 2 });
    expect(executions.refund).toBe(before + 2);
    expect(ra.body.amount).toBe(1);
    expect(rb.body.amount).toBe(2);
    expect(rb.headers['idempotent-replay']).toBeUndefined();
  });

  it('requires a session on the guarded route', async () => {
    const res = await request(app)
      .post('/api/v1/_t/refunds')
      .set('Idempotency-Key', 'anon-key-0001')
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('concurrency', () => {
  it('a duplicate that arrives while the first is still running gets 409 and does not run the handler', async () => {
    const cookie = await cookieFor();
    const before = executions.slow;
    const first = post('/_t/slow', cookie, 'slow-key-0001').then((r) => r);
    // wait until the first request is inside the handler
    for (let i = 0; i < 100 && executions.slow === before; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(executions.slow).toBe(before + 1);

    const duplicate = await post('/_t/slow', cookie, 'slow-key-0001');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
    expect(duplicate.headers['retry-after']).toBe('1');
    expect(executions.slow).toBe(before + 1);

    releaseSlow();
    expect((await first).status).toBe(200);
    // once finished, the same key replays
    const replay = await post('/_t/slow', cookie, 'slow-key-0001');
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
  });

  it('two truly simultaneous identical requests run the handler once', async () => {
    const cookie = await cookieFor();
    const before = executions.refund;
    const results = await Promise.all([
      post('/_t/refunds', cookie, 'simul-key-0001', { amount: 7 }),
      post('/_t/refunds', cookie, 'simul-key-0001', { amount: 7 }),
      post('/_t/refunds', cookie, 'simul-key-0001', { amount: 7 }),
    ]);
    expect(executions.refund).toBe(before + 1);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
  });
});

describe('failures do not poison the key', () => {
  it('a rejected request (4xx) is not stored: the corrected request can reuse the key... as a new request', async () => {
    const cookie = await cookieFor();
    const over = await post('/_t/failing', cookie, 'failing-key-0001', { amount: 500 });
    expect(over.status).toBe(403);
    // a 4xx releases the key, so the same key with a corrected body is accepted (not "reused")
    const fixed = await post('/_t/failing', cookie, 'failing-key-0001', { amount: 50 });
    expect(fixed.status).toBe(201);
    const replay = await post('/_t/failing', cookie, 'failing-key-0001', { amount: 50 });
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body).toEqual(fixed.body);
  });

  it('a crash (500) releases the key too', async () => {
    const cookie = await cookieFor();
    const res = await post('/_t/crash', cookie, 'crash-key-00001');
    expect(res.status).toBe(500);
    await new Promise((r) => setTimeout(r, 200)); // the finish handler settles after the response
    const after = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM idempotency_keys WHERE key LIKE $1`,
      ['%:crash-key-00001'],
    );
    expect(after.rows[0].n).toBe(0);
  });
});

describe('retention: 24 hours', () => {
  it('a stored response is replayed for 24 h and the key is reusable afterwards', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const before = executions.refund;
    await post('/_t/refunds', await freshCookie(user), 'expiry-key-0001', { amount: 3 });
    env.clock.advance(IDEMPOTENCY_TTL_MS - 1000);
    const replay = await post('/_t/refunds', await freshCookie(user), 'expiry-key-0001', {
      amount: 3,
    });
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(executions.refund).toBe(before + 1);

    env.clock.advance(2000);
    const fresh = await post('/_t/refunds', await freshCookie(user), 'expiry-key-0001', {
      amount: 3,
    });
    expect(fresh.headers['idempotent-replay']).toBeUndefined();
    expect(executions.refund).toBe(before + 2);
  });

  it('purgeExpired() removes rows older than 24 h and keeps newer ones', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await post('/_t/refunds', await freshCookie(user), 'purge-key-00001', { amount: 1 });
    env.clock.advance(IDEMPOTENCY_TTL_MS + 1000);
    await post('/_t/refunds', await freshCookie(user), 'purge-key-00002', { amount: 1 });
    const removed = await repo.purgeExpired(env.clock.now());
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await env.db.owner.query(
      `SELECT key FROM idempotency_keys WHERE key LIKE '%:purge-key-%' ORDER BY key`,
    );
    expect(left.rows.map((r: { key: string }) => r.key.split(':')[1])).toEqual(['purge-key-00002']);
  });

  it('a request that never finished can be taken over after the in-progress timeout', async () => {
    const cookie = await cookieFor();
    const me = await env.api(app).get('/me').set('Cookie', cookie);
    const key = `${me.body.user.id}:stale-key-00001`;
    await env.db.owner.query(
      `INSERT INTO idempotency_keys (key, route, user_id, request_hash, created_at) VALUES ($1, 'POST /api/v1/_t/refunds', $2, $3, $4)`,
      [
        key,
        me.body.user.id,
        requestFingerprint('POST', '/api/v1/_t/refunds', { amount: 9 }),
        env.clock.now(),
      ],
    );
    expect((await post('/_t/refunds', cookie, 'stale-key-00001', { amount: 9 })).status).toBe(409);
    env.clock.advance(IN_PROGRESS_TIMEOUT_MS + 1000);
    expect((await post('/_t/refunds', cookie, 'stale-key-00001', { amount: 9 })).status).toBe(201);
  });
});
