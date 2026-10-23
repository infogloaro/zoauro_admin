import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError } from './chunk-reload';

// A chunk that failed to load (a short network drop through the demo tunnel) reloads once, never in a loop.

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const chunk = Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' });

describe('chunk load errors', () => {
  it('recognises webpack, CSS and dynamic-import failures, nothing else', () => {
    expect(isChunkLoadError(chunk)).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk app-layout failed'))).toBe(true);
    expect(
      isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /x.js')),
    ).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Loading chunk 1 failed')).toBe(false);
  });

  it('reloads once; a second failure within a minute shows the error page; later it may reload again', () => {
    const s = store();
    const reload = vi.fn();
    expect(reloadOnceForChunkError(chunk, s, reload, 1_000_000)).toBe(true);
    expect(reloadOnceForChunkError(chunk, s, reload, 1_030_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnceForChunkError(chunk, s, reload, 1_100_000)).toBe(true);
    expect(reloadOnceForChunkError(new Error('boom'), store(), reload)).toBe(false);
    expect(reloadOnceForChunkError(chunk, undefined, reload)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(reloadOnceForChunkError(chunk, broken, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
