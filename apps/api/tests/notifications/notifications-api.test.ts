import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../../src/lib/mailer';
import {
  createNotificationsModule,
  type NotificationsService,
} from '../../src/modules/notifications';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// M17 Notifications against a real database (D94, D99, D100, D134–D137): scope for SuperAdmin, Admin(A), Admin(A+B),
// Admin(none); compose, approval of a Zonal Admin's promotion (approver ≠ requester), reject, edit, cancel; channels
// gated by settings; one send per zone, a promotion held to the zone's window (IST); the send step emits
// broadcast.created, emails the audience and is idempotent.

let env: AuthTestEnv;
let app: Express;
let superAdmin: TestUser;
let sa: Signed;
let sa2: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let readOnlyA: Signed;
let zoneA: string;
let zoneB: string;
let worker: NotificationsService;
const mails: MailMessage[] = [];
const queued: { sendId: string; delayMs: number }[] = [];

const as = (s: Signed) => client(s, app);
async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

const IST_MS = (5 * 60 + 30) * 60_000;
/** move the test clock forward to the next hh:mm in India time */
function advanceToIst(hh: number, mm = 0): void {
  const now = env.clock.now().getTime();
  const local = now + IST_MS;
  const day = Math.floor(local / 86_400_000) * 86_400_000;
  let target = day + (hh * 60 + mm) * 60_000;
  if (target <= local) target += 86_400_000;
  env.clock.advance(target - local);
}
const users: Record<'sa' | 'sa2' | 'a' | 'ab' | 'none' | 'ro', TestUser> = {} as Record<
  'sa' | 'sa2' | 'a' | 'ab' | 'none' | 'ro',
  TestUser
>;
/** sessions end after 30 idle minutes: sign everyone in again after moving the clock */
async function resign(): Promise<void> {
  sa = await signed(users.sa);
  sa2 = await signed(users.sa2);
  adminA = await signed(users.a);
  adminAB = await signed(users.ab);
  adminNone = await signed(users.none);
  readOnlyA = await signed(users.ro);
}
async function moveToIst(hh: number): Promise<void> {
  advanceToIst(hh);
  await resign();
}
const istHour = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).getUTCHours();

const base = (zoneIds: string[], over: Record<string, unknown> = {}) => ({
  kind: 'MESSAGE',
  audience: 'CUSTOMERS',
  zoneIds,
  title: 'Service update',
  body: 'Deliveries may be slower during the rain.',
  channels: ['IN_APP'],
  ...over,
});

const sendsOf = async (id: string) =>
  (
    await env.db.owner.query(
      `SELECT id, zone_id, status, send_at, emails_sent, emails_failed FROM notification_zone_sends
       WHERE notification_id = $1 ORDER BY zone_id`,
      [id],
    )
  ).rows as {
    id: string;
    zone_id: string;
    status: string;
    send_at: Date;
    emails_sent: number;
    emails_failed: number;
  }[];
const audit = async (id: string) =>
  (
    (
      await env.db.owner.query(
        `SELECT action FROM audit_logs WHERE entity_type = 'notification' AND entity_id = $1 ORDER BY id`,
        [id],
      )
    ).rows as { action: string }[]
  ).map((r) => r.action);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  superAdmin = await env.createUser('SUPER_ADMIN');
  users.sa = superAdmin;
  users.sa2 = await env.createUser('SUPER_ADMIN');
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({
    notifications: ['view', 'add', 'edit', 'status', 'delete'],
  });
  const viewOnly = await env.createProfile({ notifications: ['view'] });
  users.a = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(users.a.id, zoneA, superAdmin.id, { profileId: full });
  users.ab = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(users.ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(users.ab.id, zoneB, superAdmin.id, { profileId: viewOnly });
  users.none = await env.createUser('ZONAL_ADMIN');
  users.ro = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(users.ro.id, zoneA, superAdmin.id, { profileId: viewOnly });
  await resign();

  // the worker side: its own service on the same database, with a recording queue and mailer
  worker = createNotificationsModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost',
    settings: {
      notificationChannels: async () => ({ inApp: true, email: true, sms: false, whatsapp: false }),
      notificationTiming: async () => ({ promotionalFrom: '09:00', promotionalTo: '21:00' }),
    },
    queue: { enqueue: async (sendId, delayMs) => void queued.push({ sendId, delayMs }) },
    mailer: { send: async (m) => void mails.push(m) },
    clock: env.clock.now,
  }).service;

  // two customers with an email in zone A (one blocked), one in zone B
  for (const [zone, status, email] of [
    [zoneA, 'ACTIVE', 'asha@example.test'],
    [zoneA, 'BLOCKED', 'blocked@example.test'],
    [zoneB, 'ACTIVE', 'bala@example.test'],
  ] as const) {
    const id = uuidv7();
    await env.db.owner.query(
      `INSERT INTO customers (id, name, phone, email, status, updated_at) VALUES ($1, 'C', $2, $3, $4, now())`,
      [id, `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, email, status],
    );
    await env.db.owner.query(
      `INSERT INTO customer_addresses (id, customer_id, zone_id, label, address, pincode, updated_at)
       VALUES ($1, $2, $3, 'Home', '1 Street, Chennai', '600001', now())`,
      [uuidv7(), id, zone],
    );
  }
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('compose (D134, D135)', () => {
  it('a Super Admin MESSAGE to every zone is SCHEDULED with one send per live zone; audited', async () => {
    const r = await as(sa).post('/notifications', base([]));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ kind: 'MESSAGE', status: 'SCHEDULED', zones: [], version: 1 });
    const sends = await sendsOf(r.body.id);
    expect(sends.map((s) => s.zone_id)).toEqual(expect.arrayContaining([zoneA, zoneB]));
    expect(await audit(r.body.id)).toEqual(['broadcast.created']);
  });

  it('a Zonal Admin: own zones only; every zone is Super Admin only; view-only cannot compose', async () => {
    expect((await as(adminA).post('/notifications', base([]))).status).toBe(403);
    expect((await as(adminA).post('/notifications', base([zoneB]))).status).toBe(404);
    expect((await as(adminAB).post('/notifications', base([zoneB]))).status).toBe(403);
    expect((await as(readOnlyA).post('/notifications', base([zoneA]))).status).toBe(403);
    expect((await as(adminNone).post('/notifications', base([zoneA]))).status).toBe(403);
    const ok = await as(adminA).post('/notifications', base([zoneA]));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'SCHEDULED', zones: [{ id: zoneA }] });
  });

  it('SMS is refused until a provider is ready (D68); validation (D135)', async () => {
    const sms = await as(sa).post('/notifications', base([zoneA], { channels: ['IN_APP', 'SMS'] }));
    expect(sms.status).toBe(422);
    expect(sms.body.error.details).toEqual([{ field: 'channels', issue: 'SMS_NOT_AVAILABLE' }]);
    expect((await as(sa).post('/notifications', base([zoneA], { title: 'Hi' }))).status).toBe(422);
    const far = new Date(env.clock.now().getTime() + 40 * 86_400_000).toISOString();
    expect((await as(sa).post('/notifications', base([zoneA], { scheduledAt: far }))).status).toBe(
      422,
    );
  });
});

describe('promotions (D94, D100, D136)', () => {
  it('a Zonal Admin promotion waits for a Super Admin, is held to 09:00 IST when approved at 23:00', async () => {
    await moveToIst(23);
    const r = await as(adminA).post(
      '/notifications',
      base([zoneA], { kind: 'PROMOTION', title: 'Diwali offer' }),
    );
    expect(r.body.status).toBe('PENDING_APPROVAL');
    expect(await sendsOf(r.body.id)).toEqual([]);
    expect(
      (await as(adminA).post(`/notifications/${r.body.id}/approve`, { version: 1 })).status,
    ).toBe(403);
    const ok = await as(sa).post(`/notifications/${r.body.id}/approve`, { version: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('SCHEDULED');
    expect(ok.body.decidedBy.id).toBe(superAdmin.id);
    expect(ok.body.sends).toHaveLength(1);
    expect(istHour(ok.body.sends[0].sendAt)).toBe(9);
    expect(await audit(r.body.id)).toEqual(['broadcast.created', 'notification.approved']);
  });

  it('a Super Admin promotion needs no approval; its own requester can never approve one', async () => {
    await moveToIst(12);
    const own = await as(sa).post('/notifications', base([zoneA], { kind: 'PROMOTION' }));
    expect(own.body.status).toBe('SCHEDULED');
    const zonal = await as(adminA).post('/notifications', base([zoneA], { kind: 'PROMOTION' }));
    expect(zonal.body.status).toBe('PENDING_APPROVAL');
    const rej = await as(sa2).post(`/notifications/${zonal.body.id}/reject`, {
      version: 1,
      note: 'Please add the offer dates',
    });
    expect(rej.body).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Please add the offer dates',
    });
    expect(
      (await as(sa2).post(`/notifications/${zonal.body.id}/approve`, { version: 2 })).status,
    ).toBe(409);
  });

  it('a Zonal Admin edit sends an approved promotion back to approval; stale versions are 409', async () => {
    await moveToIst(10);
    const p = await as(adminA).post(
      '/notifications',
      base([zoneA], {
        kind: 'PROMOTION',
        scheduledAt: new Date(env.clock.now().getTime() + 3600_000).toISOString(),
      }),
    );
    await as(sa).post(`/notifications/${p.body.id}/approve`, { version: 1 });
    const stale = await as(adminA).patch(`/notifications/${p.body.id}`, {
      title: 'New title',
      version: 1,
    });
    expect(stale.status).toBe(409);
    const edit = await as(adminA).patch(`/notifications/${p.body.id}`, {
      title: 'New title',
      version: 2,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({
      status: 'PENDING_APPROVAL',
      title: 'New title',
      decidedBy: null,
    });
    expect((await sendsOf(p.body.id)).map((s) => s.status)).toEqual(['CANCELLED']);
  });
});

describe('cancel, scope, the send step (D136)', () => {
  it('cancel before sending; list scope per actor', async () => {
    const r = await as(adminA).post(
      '/notifications',
      base([zoneA], {
        title: 'Scope check',
        scheduledAt: new Date(env.clock.now().getTime() + 3600_000).toISOString(),
      }),
    );
    const c = await as(adminA).post(`/notifications/${r.body.id}/cancel`, { version: 1 });
    expect(c.body.status).toBe('CANCELLED');
    expect((await sendsOf(r.body.id)).map((s) => s.status)).toEqual(['CANCELLED']);
    const inB = await as(sa).post('/notifications', base([zoneB], { title: 'Scope check' }));
    const ids = async (s: Signed) =>
      ((await as(s).get('/notifications?q=Scope%20check')).body.data as { id: string }[]).map(
        (n) => n.id,
      );
    expect(await ids(adminA)).toEqual([r.body.id]);
    expect((await ids(adminAB)).sort()).toEqual([r.body.id, inB.body.id].sort());
    expect(await ids(adminNone)).toEqual([]);
    expect((await as(adminA).get(`/notifications/${inB.body.id}`)).status).toBe(404);
  });

  it('runSend: broadcast.created to the apps, emails to the zone audience, SENT, idempotent', async () => {
    const r = await as(sa).post(
      '/notifications',
      base([zoneA], { title: 'Rain update', channels: ['IN_APP', 'PUSH', 'EMAIL'] }),
    );
    const [send] = await sendsOf(r.body.id);
    expect(send).toBeDefined();
    const sendId = (send as { id: string }).id;
    expect(await worker.runSend(sendId, { finalAttempt: false })).toBe('sent');
    expect(await worker.runSend(sendId, { finalAttempt: false })).toBe('skipped');
    const [after] = await sendsOf(r.body.id);
    expect(after).toMatchObject({ status: 'SENT', emails_sent: 1, emails_failed: 0 });
    expect(mails.filter((m) => m.subject === 'Rain update').map((m) => m.to)).toEqual([
      'asha@example.test',
    ]);
    const events = (
      await env.db.owner.query(
        `SELECT payload_json FROM outbox WHERE event_type = 'broadcast.created' AND payload_json->'aggregate'->>'id' = $1`,
        [r.body.id],
      )
    ).rows as { payload_json: { data: Record<string, unknown> } }[];
    expect(events).toHaveLength(1);
    expect(events[0]?.payload_json.data).toMatchObject({
      audienceType: 'CUSTOMERS',
      zoneIds: [zoneA],
      title: 'Rain update',
      channels: ['IN_APP', 'PUSH'],
    });
    const detail = await as(sa).get(`/notifications/${r.body.id}`);
    expect(detail.body.status).toBe('SENT');
    expect(await audit(r.body.id)).toEqual(['broadcast.created', 'notification.sent']);
  });

  it('a send not yet due is left for later; the sweep re-enqueues due sends', async () => {
    const later = new Date(env.clock.now().getTime() + 2 * 3600_000).toISOString();
    const r = await as(sa).post('/notifications', base([zoneB], { scheduledAt: later }));
    const [send] = await sendsOf(r.body.id);
    const sendId = (send as { id: string }).id;
    expect(await worker.runSend(sendId, { finalAttempt: false })).toBe('not_due');
    env.clock.advance(2 * 3600_000 + 1000);
    queued.length = 0;
    expect(await worker.sweep()).toBeGreaterThanOrEqual(1);
    expect(queued.map((q) => q.sendId)).toContain(sendId);
  });
});

void reauth;
