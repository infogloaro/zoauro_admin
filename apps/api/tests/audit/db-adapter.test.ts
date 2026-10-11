import { describe, expect, it } from 'vitest';
import { auditTx } from '../../src/lib/db';
import { record, runWithAuditContext } from '../../src/lib/audit';
import type { AuditActor } from '../../src/lib/audit';

// The Prisma adapter (src/lib/db.ts): absent JSON stays absent (SQL NULL), never Prisma.JsonNull; AuditRow is unchanged.
const actor: AuditActor = {
  type: 'USER',
  id: '0192f1d2-0000-7000-8000-0000000000c1',
  name: 'Karthik M',
  role: 'ZONAL_ADMIN',
};
const ZONE = '0192f1d2-0000-7000-8000-00000000000a';

function fakeTx() {
  const created: Record<string, unknown>[] = [];
  const many: Record<string, unknown>[][] = [];
  const tx = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        many.push(data);
        return { count: data.length };
      },
    },
  } as unknown as Parameters<typeof auditTx>[0];
  return { tx, created, many };
}

describe('auditTx (Prisma adapter)', () => {
  it('passes JSON through when present and leaves it out when absent', async () => {
    const { tx, created } = fakeTx();
    await runWithAuditContext({ actor, ip: '203.0.113.5' }, async () => {
      await record(auditTx(tx), {
        module: 'restaurants',
        action: 'restaurant.commission_changed',
        entity: { type: 'restaurant', id: ZONE, label: 'Annapoorna Mess', zoneId: ZONE },
        before: { commissionPct: 10 },
        after: { commissionPct: 12 },
      });
      await record(auditTx(tx), {
        module: 'customers',
        action: 'customer.contact_revealed',
        entity: { type: 'customer', id: ZONE, label: 'Asha', zoneId: ZONE },
      });
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      beforeJson: { commissionPct: 10 },
      afterJson: { commissionPct: 12 },
    });
    // event-style action: the keys must not exist at all (an explicit null/JsonNull would store a JSON null)
    expect(Object.keys(created[1] ?? {})).not.toContain('beforeJson');
    expect(Object.keys(created[1] ?? {})).not.toContain('afterJson');
  });
});
