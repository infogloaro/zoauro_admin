import { describe, expect, it } from 'vitest';
import {
  buildCursorPage,
  buildPage,
  cursorFetchSize,
  cursorQuerySchema,
  multiValue,
  pageQuerySchema,
  pageWindow,
} from './pagination';
import { z } from 'zod';
import { ERROR_CODES, ERROR_STATUS, errorBodySchema } from './errors';

const schema = pageQuerySchema(['createdAt', 'name'], { field: 'createdAt', direction: 'desc' });

describe('page query', () => {
  it('applies the defaults from doc 09', () => {
    expect(schema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sort: { field: 'createdAt', direction: 'desc' },
    });
  });

  it('coerces query-string numbers and parses sort direction', () => {
    const q = schema.parse({ page: '3', pageSize: '50', sort: '-name', q: '  anna ' });
    expect(q).toMatchObject({
      page: 3,
      pageSize: 50,
      sort: { field: 'name', direction: 'desc' },
      q: 'anna',
    });
    expect(schema.parse({ sort: 'name' }).sort).toEqual({ field: 'name', direction: 'asc' });
  });

  it('rejects page size over 100, page 0, unknown sort fields and reversed date ranges', () => {
    expect(schema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(schema.safeParse({ page: '0' }).success).toBe(false);
    expect(schema.safeParse({ sort: 'passwordHash' }).success).toBe(false);
    expect(schema.safeParse({ sort: 'name; drop table' }).success).toBe(false);
    expect(
      schema.safeParse({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }).success,
    ).toBe(true);
  });

  it('computes the skip/take window and the response envelope', () => {
    expect(pageWindow({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(pageWindow({ page: 4, pageSize: 10 })).toEqual({ skip: 30, take: 10 });
    expect(buildPage(['a'], 41, { page: 2, pageSize: 25 })).toEqual({
      data: ['a'],
      meta: { page: 2, pageSize: 25, total: 41 },
    });
  });
});

describe('cursor query', () => {
  it('defaults to 50, caps at 100, and needs a uuid cursor', () => {
    expect(cursorQuerySchema.parse({}).limit).toBe(50);
    expect(cursorQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ after: 'nope' }).success).toBe(false);
    expect(
      cursorQuerySchema.safeParse({ after: '0192f1d2-0000-7000-8000-00000000000a' }).success,
    ).toBe(true);
  });

  it('builds a page from limit + 1 rows: next cursor is the last returned id, null on the last page', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(cursorFetchSize(2)).toBe(3);
    expect(buildCursorPage(rows, 2, (r) => r.id)).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      meta: { limit: 2, nextCursor: 'b' },
    });
    expect(buildCursorPage(rows.slice(0, 2), 2, (r) => r.id).meta.nextCursor).toBeNull();
    expect(buildCursorPage([], 2, (r: { id: string }) => r.id)).toEqual({
      data: [],
      meta: { limit: 2, nextCursor: null },
    });
  });
});

describe('repeatable filters', () => {
  const status = multiValue(z.enum(['ACTIVE', 'INACTIVE']));
  it('accepts one value, several values, or none', () => {
    expect(status.parse('ACTIVE')).toEqual(['ACTIVE']);
    expect(status.parse(['ACTIVE', 'INACTIVE'])).toEqual(['ACTIVE', 'INACTIVE']);
    expect(status.parse(undefined)).toBeUndefined();
    expect(status.safeParse('BOGUS').success).toBe(false);
  });
});

describe('error codes (doc 09)', () => {
  it('has every code of doc 09 with its HTTP status', () => {
    expect(ERROR_STATUS).toMatchObject({
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      ZONE_NOT_FOUND: 404,
      VALIDATION_ERROR: 422,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INVALID_STATE_TRANSITION: 409,
      REFUND_LIMIT_EXCEEDED: 403,
      REAUTH_REQUIRED: 401,
      INTERNAL: 500,
    });
    expect(ERROR_CODES).toHaveLength(Object.keys(ERROR_STATUS).length);
  });

  it('the error body schema accepts the documented shape and rejects unknown codes', () => {
    expect(
      errorBodySchema.safeParse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [{ field: 'email', issue: 'invalid' }],
          requestId: 'r1',
        },
      }).success,
    ).toBe(true);
    expect(errorBodySchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(
      false,
    );
  });
});
