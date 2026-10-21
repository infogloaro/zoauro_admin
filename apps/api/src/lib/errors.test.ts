import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler, isTransientDbError } from './errors';

// A transient database connection problem is 503 SERVICE_UNAVAILABLE with Retry-After (a retry can succeed), never a
// 500; anything else unknown stays 500 INTERNAL.

const appThrowing = (err: unknown) => {
  const app = express();
  app.get('/x', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
};
const prismaLike = (code: string) =>
  Object.assign(new Error('db'), { name: 'PrismaClientKnownRequestError', code });

describe('transient database errors (503, not 500)', () => {
  it('recognises Prisma P1001/P1002/P1017/P2024, init errors, pg socket errors and wrapped causes', () => {
    for (const c of ['P1001', 'P1002', 'P1017', 'P2024'])
      expect(isTransientDbError(prismaLike(c))).toBe(true);
    expect(
      isTransientDbError({ name: 'PrismaClientInitializationError', errorCode: 'P1001' }),
    ).toBe(true);
    expect(isTransientDbError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientDbError(new Error('wrap', { cause: prismaLike('P2024') }))).toBe(true);
    expect(isTransientDbError(prismaLike('P2002'))).toBe(false); // a unique violation is not transient
    expect(isTransientDbError(new Error('boom'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  // the pg driver adapter (@prisma/adapter-pg): the SQLSTATE sits in meta.driverAdapterError.cause
  const adapterError = (cause: Record<string, unknown>, code = 'P2010') =>
    Object.assign(new Error('Database error'), {
      name: 'PrismaClientKnownRequestError',
      code,
      meta: {
        driverAdapterError: Object.assign(new Error('x'), { name: 'DriverAdapterError', cause }),
      },
    });

  it('recognises the pg adapter shape: recovery (57P03), admin shutdown, connection classes and lost sockets', () => {
    for (const code of ['57P03', '57P01', '08006', '08001'])
      expect(isTransientDbError(adapterError({ kind: 'postgres', code })), code).toBe(true);
    expect(isTransientDbError(adapterError({ kind: 'postgres', originalCode: '57P03' }))).toBe(
      true,
    );
    for (const kind of [
      'DatabaseNotReachable',
      'ConnectionClosed',
      'SocketTimeout',
      'TooManyConnections',
    ])
      expect(isTransientDbError(adapterError({ kind })), kind).toBe(true);
    // a constraint violation through the adapter stays a real error
    expect(isTransientDbError(adapterError({ kind: 'postgres', code: '23505' }, 'P2002'))).toBe(
      false,
    );
    expect(isTransientDbError(adapterError({ kind: 'UniqueConstraintViolation' }, 'P2002'))).toBe(
      false,
    );
  });

  it('the adapter recovery error answers 503 and the log line carries the SQLSTATE, not the message', async () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => lines.push(a.join(' '));
    try {
      const g = await request(appThrowing(adapterError({ kind: 'postgres', code: '57P03' }))).get(
        '/x',
      );
      expect(g.status).toBe(503);
      expect(g.headers['retry-after']).toBe('5');
    } finally {
      console.error = orig;
    }
    expect(lines.some((l) => l.includes('code=57P03') && !l.includes('Database error'))).toBe(true);
  });

  it('answers 503 SERVICE_UNAVAILABLE with Retry-After', async () => {
    const r = await request(appThrowing(prismaLike('P2024'))).get('/x');
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('5');
    expect(r.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('anything else unknown is still 500 INTERNAL', async () => {
    const r = await request(appThrowing(new Error('boom'))).get('/x');
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL');
  });
});
