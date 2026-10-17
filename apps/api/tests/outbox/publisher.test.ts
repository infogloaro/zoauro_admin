import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/lib/db';
import {
  createOutboxPublisher,
  OutboxRepository,
  signature,
  webhookSecretAad,
  type WebhookTransport,
} from '../../src/lib/outbox';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';
import { createTestDatabase, uuidv7, type TestDatabase } from '../audit/support/db';

// Outbox publisher against a real throwaway database (SA-4.5 / IH-5 delivery, docs 08, 43): fan-out to matching
// subscriptions only, SKIP LOCKED with two publishers at once, lease on claimed deliveries, retries, dead letter + alert.

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let repo: OutboxRepository;
const box = createSecretBox({ current: 'outbox-test-key-0123456789abcdef0123456789' });

async function client(
  type: 'CUSTOMER_APP' | 'VENDOR_APP' | 'PARTNER_APP',
  over: { scopes?: string[]; status?: 'ACTIVE' | 'DISABLED' } = {},
) {
  const id = uuidv7();
  await prisma.apiClient.create({
    data: {
      id,
      name: `${type} ${id.slice(-6)}`,
      type,
      environment: 'SANDBOX',
      keyId: `key_${id}`,
      scopes: over.scopes ?? ['events:read'],
      ipAllowlist: [],
      rateLimitPerMin: 600,
      status: over.status ?? 'ACTIVE',
    },
  });
  return id;
}

async function subscription(clientId: string, eventTypes: string[], secret = 'whsec_test') {
  const id = uuidv7();
  await prisma.webhookSubscription.create({
    data: {
      id,
      clientId,
      url: 'https://hooks.example/zoauro',
      secretEncrypted: box.seal(secret, webhookSecretAad(id)),
      eventTypes,
    },
  });
  return id;
}

async function outbox(eventType: string) {
  const id = uuidv7();
  await prisma.outbox.create({
    data: {
      id,
      eventType,
      payloadJson: { eventId: id, type: eventType, schemaVersion: 1, data: {} },
    },
  });
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.appUrl);
  repo = new OutboxRepository(prisma);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.close();
});

beforeEach(async () => {
  // zoauro_app may not delete outbox rows; publish whatever earlier tests left so each test starts from a drained outbox
  await repo.publishBatch(10_000, new Date());
  await prisma.webhookDelivery.updateMany({
    where: { status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'DEAD' },
  });
});

describe('publish: fan-out', () => {
  it('one delivery per subscription that lists the type, of a receiving client type with events:read', async () => {
    const customer = await client('CUSTOMER_APP');
    const vendor = await client('VENDOR_APP');
    const noScope = await client('CUSTOMER_APP', { scopes: ['orders:create'] });
    const disabled = await client('CUSTOMER_APP', { status: 'DISABLED' });
    const sCustomer = await subscription(customer, ['refund.updated', 'zone.updated']);
    await subscription(vendor, ['refund.updated']); // refund.updated goes to the customer app only
    await subscription(noScope, ['refund.updated']);
    const sDisabled = await subscription(disabled, ['refund.updated']); // queues, waits for the client

    const refund = await outbox('refund.updated');
    const internal = await outbox('admin.zones_changed');

    const published = await repo.publishBatch(100, new Date());
    expect(published.map((r) => r.id)).toEqual([refund, internal]);

    const rows = await prisma.webhookDelivery.findMany({
      where: { outboxId: { in: [refund, internal] } },
    });
    expect(rows.map((r) => r.subscriptionId).sort()).toEqual([sCustomer, sDisabled].sort());
    expect(
      rows.every((r) => r.status === 'PENDING' && r.attempt === 1 && r.eventId === refund),
    ).toBe(true);

    const marked = await prisma.outbox.findMany({ where: { id: { in: [refund, internal] } } });
    expect(marked.every((r) => r.publishedAt !== null && r.attempts === 1)).toBe(true);
    expect(await repo.publishBatch(100, new Date())).toEqual([]);
  });

  it('two publishers at once never take the same row (FOR UPDATE SKIP LOCKED)', async () => {
    const c = await client('PARTNER_APP');
    await subscription(c, ['partner.force_offline']);
    const ids = [];
    for (let i = 0; i < 40; i++) ids.push(await outbox('partner.force_offline'));

    const repoB = new OutboxRepository(createPrismaClient(db.appUrl));
    const [a, b] = await Promise.all([
      repo.publishBatch(25, new Date()),
      repoB.publishBatch(25, new Date()),
    ]);
    const rest = await repo.publishBatch(100, new Date());
    const all = [...a, ...b, ...rest].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([...ids].sort());
    expect(await prisma.webhookDelivery.count({ where: { outboxId: { in: ids } } })).toBe(40);
  });
});

describe('deliver', () => {
  it('signs, delivers, and a claimed delivery is invisible to a second worker until its lease ends', async () => {
    const c = await client('VENDOR_APP');
    const s = await subscription(c, ['vendor.updated'], 'whsec_vendor');
    const o = await outbox('vendor.updated');
    const now = new Date();
    await repo.publishBatch(100, now);

    const claimed = await repo.claimDue(10, now, new Date(now.getTime() + 60_000));
    expect(claimed.map((d) => d.subscription.id)).toEqual([s]);
    expect(await repo.claimDue(10, now, new Date(now.getTime() + 60_000))).toEqual([]);
    // lease over: due again (a worker that died mid-send)
    const later = new Date(now.getTime() + 61_000);
    expect((await repo.claimDue(10, later, new Date(later.getTime() + 60_000))).length).toBe(1);

    const sent: { headers: Record<string, string>; body: string }[] = [];
    const transport: WebhookTransport = {
      name: 'http',
      send: async (r) => (sent.push(r), { ok: true, httpStatus: 202, responseMs: 4 }),
    };
    const p = createOutboxPublisher({
      store: repo,
      transport,
      secrets: box,
      clock: () => new Date(later.getTime() + 120_000),
    });
    expect(await p.deliver()).toMatchObject({ DELIVERED: 1 });
    const [req] = sent;
    expect(req?.headers['X-Zoauro-Event-Id']).toBe(o);
    const ts = Number(req?.headers['X-Zoauro-Timestamp']);
    expect(req?.headers['X-Zoauro-Signature']).toBe(signature('whsec_vendor', ts, req?.body ?? ''));
    expect(JSON.parse(req?.body ?? '{}')).toMatchObject({ eventId: o, type: 'vendor.updated' });

    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { outboxId: o } });
    expect(row).toMatchObject({
      status: 'DELIVERED',
      httpStatus: 202,
      responseMs: 4,
      nextAttemptAt: null,
    });
  });

  it('seven failures: FAILED with the doc 43 schedule, then DEAD and one DEAD_LETTER alert', async () => {
    const c = await client('CUSTOMER_APP');
    await subscription(c, ['customer.status_changed']);
    const o = await outbox('customer.status_changed');
    let at = new Date();
    await repo.publishBatch(100, at);

    const transport: WebhookTransport = {
      name: 'http',
      send: async () => ({ ok: false, httpStatus: 500, responseMs: 1 }),
    };
    const p = createOutboxPublisher({ store: repo, transport, secrets: box, clock: () => at });
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      await p.deliver();
      const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { outboxId: o } });
      if (row.nextAttemptAt) {
        delays.push((row.nextAttemptAt.getTime() - at.getTime()) / 60_000);
        at = row.nextAttemptAt;
      }
    }
    expect(delays).toEqual([1, 5, 30, 120, 360, 1440]);
    const dead = await prisma.webhookDelivery.findFirstOrThrow({ where: { outboxId: o } });
    expect(dead).toMatchObject({
      status: 'DEAD',
      attempt: 7,
      httpStatus: 500,
      nextAttemptAt: null,
    });
    const alerts = await prisma.integrationAlert.findMany({ where: { clientId: c } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'DEAD_LETTER',
      detailJson: { deliveryId: dead.id, attempts: 7 },
    });
  });
});
