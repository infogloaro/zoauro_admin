import express, { type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from '../../src/lib/errors';
import { idempotency, type IdempotencyStore } from '../../src/lib/idempotency';

// The key is settled BEFORE the response leaves (no database: an in-memory store with the repository's semantics).
// The store records, at the moment complete()/abandon() is called, whether the response had already been ended, and can
// hold the settle step on a gate. No sleeps: every wait is on a promise the code under test resolves.

interface Row {
  requestHash: string;
  statusCode: number | null;
  body: unknown;
}
interface SettleCall {
  kind: 'complete' | 'abandon';
  /** res.writableEnded when the store was called: true means the response could already be on its way */
  endedAtCall: boolean;
}

function memoryStore() {
  const rows = new Map<string, Row>();
  const calls: SettleCall[] = [];
  let current: Response | undefined;
  let gate: Promise<void> = Promise.resolve();
  let onSettle: () => void = () => undefined;

  const record = (kind: SettleCall['kind']) => {
    calls.push({ kind, endedAtCall: current?.writableEnded ?? true });
    onSettle();
  };
  const store: IdempotencyStore = {
    async begin(i) {
      const row = rows.get(i.key);
      if (!row) {
        rows.set(i.key, { requestHash: i.requestHash, statusCode: null, body: undefined });
        return { kind: 'started' };
      }
      if (row.requestHash !== i.requestHash) return { kind: 'mismatch' };
      if (row.statusCode === null) return { kind: 'in_progress' };
      return { kind: 'replay', statusCode: row.statusCode, body: row.body };
    },
    async complete(key, statusCode, body) {
      record('complete');
      await gate;
      const row = rows.get(key);
      if (row && row.statusCode === null) Object.assign(row, { statusCode, body });
    },
    async abandon(key) {
      record('abandon');
      await gate;
      if (rows.get(key)?.statusCode === null) rows.delete(key);
    },
  };
  return {
    store,
    rows,
    calls,
    track: (res: Response) => {
      current = res;
    },
    /** Holds the next settle until release(); `settling` resolves when the store has been called. */
    hold() {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const settling = new Promise<void>((resolve) => {
        onSettle = resolve;
      });
      return { release: () => release(), settling };
    },
  };
}

function makeApp(
  mem: ReturnType<typeof memoryStore>,
  store: IdempotencyStore = mem.store,
  settleTimeoutMs?: number,
) {
  const executions = { created: 0 };
  const callbacks: string[] = [];
  let callbackSeen: () => void = () => undefined;
  const nextCallback = () =>
    new Promise<void>((resolve) => {
      callbackSeen = resolve;
    });
  const cb = (name: string) => () => {
    callbacks.push(name);
    callbackSeen();
  };

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    mem.track(res);
    next();
  });
  const guard = idempotency({ store, clock: () => new Date(), settleTimeoutMs });
  app.post('/created', guard, (req, res) => {
    executions.created += 1;
    res.status(201).json({ n: executions.created, amount: req.body?.amount ?? null });
  });
  app.post('/no-content', guard, (_req, res) => {
    res.status(204).end();
  });
  app.post('/rejected', guard, (req, res) => {
    if (req.body?.amount > 100) throw new AppError('REFUND_LIMIT_EXCEEDED', 'Over the limit');
    res.status(201).json({ ok: true });
  });
  app.post('/crash', guard, () => {
    throw new Error('boom');
  });
  app.post('/end-callback-only', guard, (_req, res) => {
    res.status(201);
    res.end(cb('callback-only'));
  });
  app.post('/end-chunk-callback', guard, (_req, res) => {
    res.status(201).end('chunk', cb('chunk-callback'));
  });
  app.post('/end-chunk-encoding-callback', guard, (_req, res) => {
    res.status(201).end('chunk+encoding', 'utf8', cb('chunk-encoding-callback'));
  });
  app.post('/double-end', guard, (_req, res) => {
    res.status(201).json({ first: true });
    // a second end() with no data, as Node allows (with data, Node itself emits ERR_STREAM_WRITE_AFTER_END)
    res.end(cb('second-end'));
  });
  app.post('/throw-after-response', guard, (_req, res) => {
    res.status(201).json({ ok: true });
    throw new Error('after the response');
  });
  app.post('/reject-after-response', guard, async (_req, res) => {
    res.status(201).json({ ok: true });
    await Promise.resolve();
    throw new AppError('CONFLICT', 'after the response');
  });

  // The real error handler, observed: resolves once it has returned, saying whether it passed the error on to
  // Express's final handler (which destroys the socket when headers count as sent).
  let errorHandled: (forwarded: boolean) => void = () => undefined;
  const nextErrorHandled = () =>
    new Promise<boolean>((resolve) => {
      errorHandled = resolve;
    });
  app.use(
    (err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      let forwarded = false;
      void errorHandler(err, req, res, (e?: unknown) => {
        forwarded = true;
        next(e);
      });
      errorHandled(forwarded);
    },
  );
  return { app, executions, callbacks, nextCallback, nextErrorHandled };
}

const post = (app: express.Express, path: string, key: string, body: object = {}) =>
  request(app).post(path).set('Idempotency-Key', key).send(body);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the key is settled before the response is sent', () => {
  it('2xx: stored before the response ends, so an immediate retry is a replay', async () => {
    const mem = memoryStore();
    const { app, executions } = makeApp(mem);
    const held = mem.hold();
    const first = post(app, '/created', 'order-key-0001', { amount: 5 }).then((r) => r);
    await held.settling;
    expect(mem.calls).toEqual([{ kind: 'complete', endedAtCall: false }]);
    held.release();

    const r1 = await first;
    const r2 = await post(app, '/created', 'order-key-0001', { amount: 5 });
    expect(r1.status).toBe(201);
    expect(r1.headers['idempotent-replay']).toBeUndefined();
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replay']).toBe('true');
    expect(r2.body).toEqual(r1.body);
    expect(executions.created).toBe(1);
  });

  it('204: stored before the empty response ends, and replayed empty', async () => {
    const mem = memoryStore();
    const { app } = makeApp(mem);
    const held = mem.hold();
    const first = post(app, '/no-content', 'order-key-0204').then((r) => r);
    await held.settling;
    expect(mem.calls).toEqual([{ kind: 'complete', endedAtCall: false }]);
    held.release();

    expect((await first).status).toBe(204);
    const replay = await post(app, '/no-content', 'order-key-0204');
    expect(replay.status).toBe(204);
    expect(replay.headers['idempotent-replay']).toBe('true');
  });

  it('4xx: the key is released before the response ends, so the corrected retry is a new request (not 422)', async () => {
    const mem = memoryStore();
    const { app } = makeApp(mem);
    const held = mem.hold();
    const first = post(app, '/rejected', 'order-key-0403', { amount: 500 }).then((r) => r);
    await held.settling;
    expect(mem.calls).toEqual([{ kind: 'abandon', endedAtCall: false }]);
    held.release();

    expect((await first).status).toBe(403);
    const fixed = await post(app, '/rejected', 'order-key-0403', { amount: 50 });
    expect(fixed.status).toBe(201);
    expect(fixed.headers['idempotent-replay']).toBeUndefined();
  });

  it('5xx: the key is released before the response ends', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mem = memoryStore();
    const { app } = makeApp(mem);
    const held = mem.hold();
    const first = post(app, '/crash', 'order-key-0500').then((r) => r);
    await held.settling;
    expect(mem.calls).toEqual([{ kind: 'abandon', endedAtCall: false }]);
    held.release();

    expect((await first).status).toBe(500);
    expect([...mem.rows.keys()].some((k) => k.endsWith(':order-key-0500'))).toBe(false);
  });

  it('keeps the documented contracts: different body = 422, still running = 409', async () => {
    const mem = memoryStore();
    const { app } = makeApp(mem);
    await post(app, '/created', 'order-key-hash', { amount: 1 });
    const reused = await post(app, '/created', 'order-key-hash', { amount: 2 });
    expect(reused.status).toBe(422);
    expect(reused.body.error.details[0]).toEqual({ field: 'Idempotency-Key', issue: 'reused' });

    const held = mem.hold();
    const running = post(app, '/created', 'order-key-busy', { amount: 1 }).then((r) => r);
    await held.settling; // the first request is settling: its key is still in progress
    const duplicate = await post(app, '/created', 'order-key-busy', { amount: 1 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers['retry-after']).toBe('1');
    held.release();
    expect((await running).status).toBe(201);
  });
});

describe('an error thrown after the handler has responded', () => {
  it.each([
    ['/throw-after-response', 'late-key-sync0001'],
    ['/reject-after-response', 'late-key-async001'],
  ])(
    '%s: the held response is still delivered, stored once, and the error only logged',
    async (path, key) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const mem = memoryStore();
      const { app, nextErrorHandled } = makeApp(mem);
      const held = mem.hold();
      const handled = nextErrorHandled();
      const first = post(app, path, key).then((r) => r);

      // both happen while the response is still held: the error reaches the error handler, the key starts settling
      const forwarded = await handled;
      await held.settling;
      expect(forwarded).toBe(false);
      expect(mem.calls).toEqual([{ kind: 'complete', endedAtCall: false }]);
      held.release();

      const res = await first;
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });
      expect(errors).toHaveBeenCalledWith(
        expect.stringContaining('error after response committed'),
      );
      const replay = await post(app, path, key);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replay']).toBe('true');
      expect(replay.body).toEqual({ ok: true });
    },
  );
});

describe('a settle problem never leaves the response hanging', () => {
  it('a rejected complete(): the response is still sent and the failure is logged', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mem = memoryStore();
    const failing: IdempotencyStore = {
      ...mem.store,
      complete: () => Promise.reject(new Error('db down')),
    };
    const { app } = makeApp(mem, failing);
    const res = await post(app, '/created', 'fail-key-00001', { amount: 1 });
    expect(res.status).toBe(201);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('idempotency settle failed'));
  });

  it('a complete() that throws synchronously: the response is still sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mem = memoryStore();
    const throwing: IdempotencyStore = {
      ...mem.store,
      complete: () => {
        throw new Error('sync');
      },
    };
    const { app } = makeApp(mem, throwing);
    expect((await post(app, '/created', 'sync-key-00001', { amount: 1 })).status).toBe(201);
  });

  it('a complete() that never returns: the response is sent after the settle timeout', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mem = memoryStore();
    const hanging: IdempotencyStore = {
      ...mem.store,
      complete: () => new Promise<void>(() => undefined),
    };
    const { app } = makeApp(mem, hanging, 25);
    const res = await post(app, '/created', 'hang-key-00001', { amount: 1 });
    expect(res.status).toBe(201);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('idempotency settle timed out'));
  });
});

describe('res.end() keeps its overloads, callbacks and exactly-once behaviour', () => {
  it.each([
    ['/end-callback-only', 'callback-only', ''],
    ['/end-chunk-callback', 'chunk-callback', 'chunk'],
    ['/end-chunk-encoding-callback', 'chunk-encoding-callback', 'chunk+encoding'],
  ])('%s: body sent, callback called exactly once', async (path, name, text) => {
    const mem = memoryStore();
    const { app, callbacks, nextCallback } = makeApp(mem);
    const seen = nextCallback();
    const res = await post(app, path, `end-key-${name}`)
      .buffer(true)
      .parse((r, done) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString('utf8')));
        r.on('end', () => done(null, data));
      });
    await seen;
    expect(res.status).toBe(201);
    expect(res.body).toBe(text);
    expect(callbacks).toEqual([name]);
    expect(mem.calls).toEqual([{ kind: 'complete', endedAtCall: false }]);
  });

  it('a second end() does not send a second body or settle the key twice; its callback still runs', async () => {
    const mem = memoryStore();
    const { app, callbacks, nextCallback } = makeApp(mem);
    const seen = nextCallback();
    const res = await post(app, '/double-end', 'double-key-0001');
    await seen;
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ first: true });
    expect(callbacks).toEqual(['second-end']);
    expect(mem.calls).toEqual([{ kind: 'complete', endedAtCall: false }]);
    const replay = await post(app, '/double-end', 'double-key-0001');
    expect(replay.body).toEqual({ first: true });
  });
});
