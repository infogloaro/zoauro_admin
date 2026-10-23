import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { allowExtraOrigins, isAllowedOrigin, originCheck } from './middleware';

// originCheck with APP_EXTRA_ORIGINS (10-22): writes from APP_URL's origin and from each extra origin pass, exact match
// only; every other origin is refused. Reads are never checked.

const APP = 'https://demo-name.trycloudflare.com';
const LOCAL = 'http://127.0.0.1:3100';

function run(method: string, origin: string | undefined): 'next' | string {
  const req = {
    method,
    get: (h: string) => (h === 'origin' ? origin : undefined),
  } as unknown as Request;
  let out: 'next' | string = 'none';
  try {
    originCheck(APP)(
      req,
      {} as Response,
      (() => {
        out = 'next';
      }) as NextFunction,
    );
  } catch (e) {
    out = e instanceof Error ? e.message : 'error';
  }
  return out;
}

afterEach(() => allowExtraOrigins([]));

describe('originCheck with extra origins', () => {
  it('accepts only APP_URL by default', () => {
    expect(run('POST', APP)).toBe('next');
    expect(run('POST', LOCAL)).toBe('Origin not allowed');
    expect(run('POST', undefined)).toBe('next');
    expect(run('GET', 'https://evil.example')).toBe('next');
  });

  it('accepts APP_URL and each extra origin, and nothing else', () => {
    allowExtraOrigins([LOCAL]);
    expect(run('POST', APP)).toBe('next');
    expect(run('DELETE', LOCAL)).toBe('next');
    expect(run('POST', 'http://127.0.0.1:3101')).toBe('Origin not allowed');
    expect(run('POST', 'http://localhost:3100')).toBe('Origin not allowed');
    expect(run('PATCH', 'https://evil.example')).toBe('Origin not allowed');
    expect(isAllowedOrigin(LOCAL, APP)).toBe(true);
    expect(isAllowedOrigin(`${LOCAL}/`, APP)).toBe(false);
  });
});
