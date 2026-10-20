import type { PermissionKey, Role } from '@zoauro/shared';
import { describe, expect, it } from 'vitest';
import { runWithAuditContext, type AuditRow } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { defineExportSource, type ExportFileStore } from '../../lib/exports';
import type { ExportFilters, ExportRow, ExportsDatabase } from './exports.repository';
import { ExportsService, MAX_ACTIVE_EXPORTS } from './exports.service';

// ExportsService against in-memory fakes: request (scope, cap, in-flight limit, audit per zone), run (the worker's
// scope re-check, CSV, failures and retries), get (signed link only while READY) and the sweep.

const A = '0192f1d2-0000-7000-8000-00000000000a';
const B = '0192f1d2-0000-7000-8000-00000000000b';
const T0 = new Date('2026-10-17T10:00:00Z');

function zonal(
  zones: string[],
  canExport = true,
  requested: string[] | 'ALL' = 'ALL',
): AuthContext {
  return {
    userId: 'zonal-user',
    role: 'ZONAL_ADMIN',
    isSuperAdmin: false,
    assignedZoneIds: zones,
    permissionsByZone: new Map(
      zones.map((z) => [z, new Set<PermissionKey>(['orders:view', 'orders:export'])]),
    ),
    limitsByZone: new Map(
      zones.map((z) => [z, { perRefund: 0, dailyRefund: 0, canReveal: false, canExport }]),
    ),
    requestedZoneIds: requested,
  };
}
const superAdmin: AuthContext = {
  ...zonal([]),
  userId: 'sa-user',
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
};

interface Row {
  zoneId: string;
  name: string;
}

function harness(
  opts: {
    rows?: Row[];
    active?: number;
    who?: { role: Role; active: boolean } | null;
    contexts?: (requested: readonly string[] | 'ALL') => Promise<AuthContext>;
    pageError?: Error;
  } = {},
) {
  const rows = opts.rows ?? [
    { zoneId: A, name: 'Asha' },
    { zoneId: B, name: '=cmd' },
  ];
  const jobs = new Map<string, ExportRow>();
  const audit: AuditRow[] = [];
  const enqueued: string[] = [];
  const files = new Map<string, string>();
  let now = T0;

  const repo = {
    findForRequester: async (ctx: AuthContext, id: string) => {
      const j = jobs.get(id);
      return j && j.requestedBy === ctx.userId ? j : null;
    },
    countActive: async () => opts.active ?? 0,
    create: async (
      ctx: AuthContext,
      r: { id: string; module: 'orders'; filters: ExportFilters },
    ) => {
      const row: ExportRow = {
        id: r.id,
        requestedBy: ctx.userId,
        module: r.module,
        status: 'QUEUED',
        filters: r.filters,
        fileKey: null,
        expiresAt: null,
        createdAt: now,
      };
      jobs.set(r.id, row);
      return row;
    },
    claim: async (id: string) => {
      const j = jobs.get(id);
      if (!j || j.status !== 'QUEUED') return null;
      j.status = 'RUNNING';
      return { ...j };
    },
    requeue: async (id: string) => {
      const j = jobs.get(id);
      if (j) j.status = 'QUEUED';
    },
    markReady: async (
      id: string,
      r: { fileKey: string; expiresAt: Date; filters: ExportFilters },
    ) => {
      const j = jobs.get(id);
      if (j)
        Object.assign(j, {
          status: 'READY',
          fileKey: r.fileKey,
          expiresAt: r.expiresAt,
          filters: r.filters,
        });
    },
    markFailed: async (id: string, filters: ExportFilters) => {
      const j = jobs.get(id);
      if (j) Object.assign(j, { status: 'FAILED', filters });
    },
    staleQueued: async () =>
      [...jobs.values()].filter((j) => j.status === 'QUEUED').map((j) => j.id),
    expiredReady: async (at: Date) =>
      [...jobs.values()]
        .filter((j) => j.status === 'READY' && j.expiresAt !== null && j.expiresAt < at)
        .map((j) => ({ id: j.id, fileKey: j.fileKey })),
    markExpired: async (id: string) => {
      const j = jobs.get(id);
      if (j) j.status = 'EXPIRED';
    },
    requester: async (userId: string) =>
      opts.who === undefined
        ? { role: (userId === 'sa-user' ? 'SUPER_ADMIN' : 'ZONAL_ADMIN') as Role, active: true }
        : opts.who,
    zoneNames: async () =>
      new Map([
        [A, 'Zone A'],
        [B, 'Zone B'],
      ]),
  };
  const db = {
    repo,
    transaction: async <T>(fn: (tx: { repo: typeof repo; audit: unknown }) => Promise<T>) =>
      fn({
        repo,
        audit: {
          auditLog: { create: async ({ data }: { data: AuditRow }) => void audit.push(data) },
        },
      }),
  } as unknown as ExportsDatabase;

  const inScope = (ctx: AuthContext) => (r: Row) =>
    ctx.isSuperAdmin
      ? ctx.requestedZoneIds === 'ALL' || ctx.requestedZoneIds.includes(r.zoneId)
      : ctx.assignedZoneIds.includes(r.zoneId) &&
        (ctx.requestedZoneIds === 'ALL' || ctx.requestedZoneIds.includes(r.zoneId));
  const source = defineExportSource<{ q?: string }, Row>({
    module: 'orders',
    viewKey: 'orders:view',
    audit: { module: 'orders', action: 'order.exported' },
    parse: (raw) => {
      if (raw['status'] === 'NOPE') throw new AppError('VALIDATION_ERROR', 'Invalid input');
      return typeof raw['q'] === 'string' ? { q: raw['q'] } : {};
    },
    count: async (ctx) => rows.filter(inScope(ctx)).length,
    page: async (ctx, _q, page) => {
      if (opts.pageError) throw opts.pageError;
      return page === 1 ? rows.filter(inScope(ctx)) : [];
    },
    columns: (l) => [
      { header: 'Zone', value: (r: Row) => l.zoneName(r.zoneId) },
      { header: 'Name', value: (r: Row) => r.name },
    ],
    filename: () => 'orders.csv',
  });
  const store: ExportFileStore = {
    put: async (key, body) => void files.set(key, body),
    signedDownload: async (key, _f, sec) => `signed://${key}?t=${Math.round(sec)}`,
    remove: async (key) => void files.delete(key),
  };
  const service = new ExportsService({
    db,
    sources: new Map([['orders', source]]),
    files: store,
    enqueue: async (id) => void enqueued.push(id),
    clock: () => now,
    contexts: {
      buildContext: async (caller, requested) =>
        opts.contexts
          ? opts.contexts(requested)
          : caller.role === 'SUPER_ADMIN'
            ? { ...superAdmin, requestedZoneIds: requested }
            : zonal([A, B], true, requested === 'ALL' ? 'ALL' : [...requested]),
    },
  });
  const asUser = <T>(ctx: AuthContext, fn: () => Promise<T>) =>
    runWithAuditContext(
      { actor: { type: 'USER', id: ctx.userId, name: 'Tester', role: ctx.role } },
      fn,
    );
  return {
    service,
    jobs,
    audit,
    enqueued,
    files,
    asUser,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : 'other';
  }
  return 'none';
};

describe('request', () => {
  it('Super Admin, all zones: one job, queued, one audit row with no zone', async () => {
    const h = harness();
    const job = await h.asUser(superAdmin, () => h.service.request(superAdmin, 'orders', {}));
    expect(job).toMatchObject({ status: 'QUEUED', zoneIds: null, rowCount: 2, downloadUrl: null });
    expect(h.enqueued).toEqual([job.id]);
    expect(h.audit.map((a) => [a.action, a.zoneId, a.entityType, a.entityId])).toEqual([
      ['order.exported', null, 'export', job.id],
    ]);
  });

  it('Zonal A+B: one audit row per zone; the free-text search is not logged', async () => {
    const h = harness();
    const ctx = zonal([A, B]);
    const job = await h.asUser(ctx, () => h.service.request(ctx, 'orders', { q: '9876543210' }));
    expect(job.zoneIds).toEqual([A, B].sort());
    expect(h.audit.map((a) => a.zoneId).sort()).toEqual([A, B].sort());
    expect(JSON.stringify(h.audit)).not.toContain('9876543210');
  });

  it('refuses: bad filter 422, no canExport 403, in-flight limit 429; nothing created', async () => {
    const h = harness();
    expect(await code(h.service.request(superAdmin, 'orders', { status: 'NOPE' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(await code(h.service.request(zonal([A], false), 'orders', {}))).toBe('FORBIDDEN');
    const busy = harness({ active: MAX_ACTIVE_EXPORTS });
    expect(await code(busy.service.request(superAdmin, 'orders', {}))).toBe('RATE_LIMITED');
    expect(h.jobs.size + busy.jobs.size).toBe(0);
  });

  it('more rows than the cap: 422 before a job exists', async () => {
    const h = harness({ rows: Array.from({ length: 100_001 }, () => ({ zoneId: A, name: 'x' })) });
    expect(await code(h.service.request(superAdmin, 'orders', {}))).toBe('VALIDATION_ERROR');
    expect(h.jobs.size).toBe(0);
  });
});

describe('run (worker)', () => {
  it('writes BOM + header + the scoped rows, then READY with a link until expiry', async () => {
    const h = harness();
    const ctx = zonal([A], true);
    const job = await h.asUser(ctx, () => h.service.request(ctx, 'orders', {}));
    // the rebuilt context is the same member, still holding A
    const h2 = h;
    expect(await h2.service.run(job.id, { finalAttempt: true })).toBe('READY');
    const [key, body] = [...h.files.entries()][0] ?? ['', ''];
    expect(key).toMatch(new RegExp(`^exports/2026/10/${job.id}\\.csv$`));
    expect(body).toBe('﻿Zone,Name\r\nZone A,Asha\r\n');
    const got = await h.service.get(ctx, job.id);
    expect(got).toMatchObject({
      status: 'READY',
      rowCount: 1,
      downloadUrl: `signed://${key}?t=86400`,
    });
  });

  it('scope lost since the request: FAILED SCOPE_CHANGED, no file', async () => {
    for (const variant of ['narrower', 'unassigned', 'inactive'] as const) {
      const h = harness({
        who: variant === 'inactive' ? { role: 'ZONAL_ADMIN', active: false } : undefined,
        contexts: async (requested) => {
          if (variant === 'unassigned') throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
          return zonal([A], true, requested === 'ALL' ? 'ALL' : [...requested]);
        },
      });
      const ctx = zonal([A, B]);
      const job = await h.asUser(ctx, () => h.service.request(ctx, 'orders', {}));
      expect(await h.service.run(job.id, { finalAttempt: true })).toBe('FAILED');
      expect(h.jobs.get(job.id)?.filters.failureReason).toBe('SCOPE_CHANGED');
      expect(h.files.size).toBe(0);
    }
  });

  it('canExport removed since the request: SCOPE_CHANGED', async () => {
    const h = harness({ contexts: async (r) => zonal([A], false, r === 'ALL' ? 'ALL' : [...r]) });
    const ctx = zonal([A]);
    const job = await h.asUser(ctx, () => h.service.request(ctx, 'orders', {}));
    expect(await h.service.run(job.id, { finalAttempt: true })).toBe('FAILED');
    expect(h.jobs.get(job.id)?.filters.failureReason).toBe('SCOPE_CHANGED');
  });

  it('an error is retried (back to QUEUED) until the final attempt, which is FAILED ERROR', async () => {
    const h = harness({ pageError: new Error('db down') });
    const job = await h.asUser(superAdmin, () => h.service.request(superAdmin, 'orders', {}));
    await expect(h.service.run(job.id, { finalAttempt: false })).rejects.toThrow('db down');
    expect(h.jobs.get(job.id)?.status).toBe('QUEUED');
    expect(await h.service.run(job.id, { finalAttempt: true })).toBe('FAILED');
    expect(h.jobs.get(job.id)?.filters.failureReason).toBe('ERROR');
    expect(await h.service.run(job.id, { finalAttempt: true })).toBeNull(); // nothing left to claim
  });
});

describe('get and sweep', () => {
  it('only the requester; an expired file is EXPIRED with no link; the sweep deletes it and requeues lost jobs', async () => {
    const h = harness();
    const job = await h.asUser(superAdmin, () => h.service.request(superAdmin, 'orders', {}));
    expect(await code(h.service.get(zonal([A]), job.id))).toBe('NOT_FOUND');
    await h.service.run(job.id, { finalAttempt: true });
    h.setNow(new Date(T0.getTime() + 25 * 3_600_000));
    expect(await h.service.get(superAdmin, job.id)).toMatchObject({
      status: 'EXPIRED',
      downloadUrl: null,
    });

    const lost = await h.asUser(superAdmin, () => h.service.request(superAdmin, 'orders', {}));
    expect(await h.service.sweep()).toEqual({ expired: 1, requeued: 1 });
    expect(h.files.size).toBe(0);
    expect(h.jobs.get(job.id)?.status).toBe('EXPIRED');
    expect(h.enqueued.filter((id) => id === lost.id)).toHaveLength(2);
  });
});
