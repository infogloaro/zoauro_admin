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
