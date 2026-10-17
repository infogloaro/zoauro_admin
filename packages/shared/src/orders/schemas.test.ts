import { describe, expect, it } from 'vitest';
import {
  ORDER_CANCELLABLE,
  ORDER_STATUSES,
  isOrderTransitionAllowed,
  orderIfMatchSchema,
  orderListQuerySchema,
  transitionOrderSchema,
} from './schemas';

// Doc 10 state machine (completed from magaraj's dev_cb table) and the doc 09 list/If-Match conventions.

describe('order transitions (doc 10)', () => {
  it('allows the doc 10 moves, including the three dev_cb lacked', () => {
    expect(isOrderTransitionAllowed('READY', 'CANCELLED')).toBe(true);
    expect(isOrderTransitionAllowed('ASSIGNED', 'READY')).toBe(true);
    expect(isOrderTransitionAllowed('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(true);
    expect(isOrderTransitionAllowed('PLACED', 'ACCEPTED')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isOrderTransitionAllowed('PLACED', 'DELIVERED')).toBe(false);
    expect(isOrderTransitionAllowed('ASSIGNED', 'CANCELLED')).toBe(false);
    expect(isOrderTransitionAllowed('DELIVERED', 'CANCELLED')).toBe(false);
    for (const s of ORDER_STATUSES) expect(isOrderTransitionAllowed('REFUNDED', s)).toBe(false);
  });

  it('lists the cancellable statuses', () => {
    expect(ORDER_CANCELLABLE).toEqual([
      'PLACED',
      'ACCEPTED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
    ]);
  });
});

describe('request schemas', () => {
  it('list: defaults, repeatable filters and the date range', () => {
    const q = orderListQuerySchema.parse({ status: 'PLACED', paymentMethod: ['COD', 'ONLINE'] });
    expect(q).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: { field: 'placedAt', direction: 'desc' },
      status: ['PLACED'],
      paymentMethod: ['COD', 'ONLINE'],
    });
    expect(orderListQuerySchema.parse({ sort: 'total' }).sort).toEqual({
      field: 'total',
      direction: 'asc',
    });
    expect(orderListQuerySchema.safeParse({ sort: '-customerPhone' }).success).toBe(false);
    expect(
      orderListQuerySchema.safeParse({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('transition: cancel and assign have their own routes', () => {
    expect(transitionOrderSchema.safeParse({ to: 'ACCEPTED' }).success).toBe(true);
    expect(transitionOrderSchema.safeParse({ to: 'CANCELLED' }).success).toBe(false);
    expect(transitionOrderSchema.safeParse({ to: 'ASSIGNED' }).success).toBe(false);
    expect(transitionOrderSchema.safeParse({ to: 'ACCEPTED', version: 3 }).success).toBe(false);
  });

  it('If-Match: plain, quoted or weak versions; nothing else', () => {
    expect(orderIfMatchSchema.parse('4')).toBe(4);
    expect(orderIfMatchSchema.parse('"4"')).toBe(4);
    expect(orderIfMatchSchema.parse('W/"4"')).toBe(4);
    expect(orderIfMatchSchema.safeParse(undefined).success).toBe(false);
    expect(orderIfMatchSchema.safeParse('abc').success).toBe(false);
    expect(orderIfMatchSchema.safeParse('0').success).toBe(false);
  });
});
