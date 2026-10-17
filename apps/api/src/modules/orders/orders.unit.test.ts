import { describe, expect, it } from 'vitest';
import { orderEventRows } from './orders.events';
import type { PartnerLockRow } from './orders.repository';
import { partnerProblem } from './orders.service';

// Pure parts of M11: the doc 10 partner guards with the D121 cap, and the outbox rows of a write.

const ZONE = '0192f1d2-0000-7000-8000-00000000000a';
const NOW = new Date('2026-10-17T10:00:00Z');
const partner = (over: Partial<PartnerLockRow> = {}): PartnerLockRow => ({
  id: '0192f1d2-0000-7000-8000-0000000000b1',
  name: 'Ravi',
  zone_id: ZONE,
  status: 'ACTIVE',
  is_online: true,
  verified_at: NOW,
  current_orders: 0,
  deleted_at: null,
  force_offline_until: null,
  ...over,
});
const issue = (p: PartnerLockRow | null, cap = 1) =>
  partnerProblem(p, ZONE, cap, NOW)?.issue ?? null;

describe('partnerProblem (doc 10 READY -> ASSIGNED, D121)', () => {
  it('passes a verified, online partner of the zone under the cap', () => {
    expect(issue(partner())).toBeNull();
    expect(issue(partner({ status: 'VERIFIED', current_orders: 1 }), 2)).toBeNull();
  });

  it('names the first failing guard', () => {
    expect(issue(null)).toBe('NOT_FOUND');
    expect(issue(partner({ deleted_at: NOW }))).toBe('NOT_FOUND');
    expect(issue(partner({ zone_id: '0192f1d2-0000-7000-8000-00000000000b' }))).toBe(
      'PARTNER_OTHER_ZONE',
    );
    expect(issue(partner({ status: 'PENDING_VERIFICATION' }))).toBe('PARTNER_NOT_VERIFIED');
    expect(issue(partner({ verified_at: null }))).toBe('PARTNER_NOT_VERIFIED');
    expect(issue(partner({ is_online: false }))).toBe('PARTNER_OFFLINE');
    expect(issue(partner({ force_offline_until: new Date(NOW.getTime() + 60_000) }))).toBe(
      'PARTNER_OFFLINE',
    );
    expect(issue(partner({ current_orders: 1 }))).toBe('PARTNER_AT_CAPACITY');
  });
});

describe('orderEventRows (events.catalog.json)', () => {
  const base = {
    orderId: '0192f1d2-0000-7000-8000-0000000000c1',
    zoneId: ZONE,
    version: 3,
    actorId: '0192f1d2-0000-7000-8000-0000000000d1',
    occurredAt: NOW,
  };

  it('a status change: one order.status_changed with the new aggregate version', () => {
    const rows = orderEventRows({ ...base, status: { from: 'READY', to: 'ASSIGNED', note: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({
      type: 'order.status_changed',
      schemaVersion: 1,
      aggregate: { type: 'order', id: base.orderId, version: 3 },
      audience: { zoneId: ZONE },
      actor: { type: 'ADMIN', id: base.actorId },
      data: { from: 'READY', to: 'ASSIGNED' },
    });
    expect(rows[0]?.payload['data']).not.toHaveProperty('note');
  });

  it('a reassignment emits only order.reassigned; a cancellation adds order.cancelled', () => {
    expect(
      orderEventRows({
        ...base,
        status: null,
        extra: { type: 'order.reassigned', fromPartnerId: 'a', toPartnerId: 'b' },
      }).map((r) => r.eventType),
    ).toEqual(['order.reassigned']);
    const cancel = orderEventRows({
      ...base,
      status: { from: 'PLACED', to: 'CANCELLED', note: 'x' },
      extra: { type: 'order.cancelled', reasonCode: 'LATE', refundExpected: false },
    });
    expect(cancel.map((r) => r.eventType)).toEqual(['order.status_changed', 'order.cancelled']);
    expect(cancel[1]?.payload['data']).toEqual({
      reasonCode: 'LATE',
      cancelledBy: 'ADMIN',
      refundExpected: false,
    });
    expect(new Set(cancel.map((r) => r.id)).size).toBe(2);
  });
});
