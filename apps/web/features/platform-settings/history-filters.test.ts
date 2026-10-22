import { describe, expect, it } from 'vitest';
import { readHistoryFilters, toIstBounds } from './history-filters';

// F9 W2: Settings History actor and date filters from the URL, and the India-time day bounds the API takes.

const ACTOR = '0192f1d2-1111-7000-8000-000000000001';
const p = (s: string) => new URLSearchParams(s);

describe('settings history filters', () => {
  it('reads a valid actor and days; anything else is no filter', () => {
    expect(readHistoryFilters(p(`actor=${ACTOR}&from=2026-10-01&to=2026-10-22`))).toEqual({
      actorId: ACTOR,
      from: '2026-10-01',
      to: '2026-10-22',
    });
    expect(readHistoryFilters(p('actor=karthik&from=yesterday&to=2026-13'))).toEqual({
      actorId: null,
      from: null,
      to: null,
    });
  });

  it('days become whole India-time bounds; a from after the to is dropped', () => {
    expect(toIstBounds('2026-10-01', '2026-10-22')).toEqual({
      from: '2026-10-01T00:00:00+05:30',
      to: '2026-10-22T23:59:59.999+05:30',
    });
    expect(toIstBounds('2026-10-23', '2026-10-22')).toEqual({
      to: '2026-10-22T23:59:59.999+05:30',
    });
    expect(toIstBounds(null, null)).toEqual({});
  });
});
