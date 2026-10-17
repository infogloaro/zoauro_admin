import {
  EXPORT_MAX_ROWS,
  EXPORT_TTL_HOURS,
  type ExportFailureReason,
  type ExportJob,
  type ExportModule,
  type Role,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { scopeKey, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import {
  CSV_BOM,
  exportFileKey,
  exportScope,
  requestedZonesOf,
  sameScope,
  type ExportFileStore,
  type ExportSource,
  type RawQuery,
} from '../../lib/exports';
import type { ExportFilters, ExportRow, ExportsDatabase } from './exports.repository';

// Export jobs (doc 09, D129). Request: the effective scope of the list (doc 36) with canExport in every zone, the row
// estimate under the cap, the job row and one order.exported audit row per exported zone (one with no zone for an
// all-zones Super Admin export) in one transaction, then the job is queued. Worker: the requester's context is rebuilt
// from the access tables; if the scope is no longer the one the job was created with, the job fails (SCOPE_CHANGED)
// before a single row is read. Rows come through the module's own scoped list, so masking (D26) is the list's.

/** Jobs a member may have queued or running at once (doc 32: a GET starts the job, so this bounds repeated clicks). */
export const MAX_ACTIVE_EXPORTS = 3;
/** A RUNNING job not touched for this long belongs to a worker that died: it may be taken again. */
export const RUNNING_STALE_MS = 15 * 60_000;
/** A QUEUED job older than this was never picked up (its enqueue was lost): the sweep queues it again. */
export const QUEUED_STALE_MS = 2 * 60_000;

export interface ContextBuilder {
  buildContext(
    caller: { userId: string; role: Role },
    requestedZoneIds: readonly string[] | 'ALL',
  ): Promise<AuthContext>;
}

function auditFilters(query: RawQuery): Record<string, string | string[] | boolean> {
  const { q, ...rest } = query;
  return q === undefined ? rest : { ...rest, q: true };
}

export class ExportsService {
  constructor(
    private readonly deps: {
      db: ExportsDatabase;
      sources: ReadonlyMap<ExportModule, ExportSource>;
      files: ExportFileStore;
      enqueue: (exportId: string) => Promise<void>;
      clock: () => Date;
      /** worker only: rebuilds the requester's AuthContext (AccessService) */
      contexts?: ContextBuilder;
      log?: (line: string) => void;
    },
  ) {}

  private source(module: ExportModule): ExportSource {
    const s = this.deps.sources.get(module);
    if (!s) throw new Error(`no export source for ${module}`);
    return s;
  }

  async request(ctx: AuthContext, module: ExportModule, query: RawQuery): Promise<ExportJob> {
    const source = this.source(module);
    source.validate(query); // 422 like the list endpoint, before anything else is read
    const scope = exportScope(ctx, source.viewKey);
    if ((await this.deps.db.repo.countActive(ctx)) >= MAX_ACTIVE_EXPORTS) {
      throw new AppError(
        'RATE_LIMITED',
        'You already have exports in progress; wait for them to finish',
        undefined,
        {
          'Retry-After': '30',
        },
      );
    }
    const estimate = await source.count(ctx, query);
    if (estimate > EXPORT_MAX_ROWS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `This export would have more than ${EXPORT_MAX_ROWS.toLocaleString('en-IN')} rows; narrow the filters`,
        [{ field: 'query', issue: 'too_many_rows' }],
        undefined,
        { estimate, max: EXPORT_MAX_ROWS },
      );
    }
    const id = uuidv7();
    const filters: ExportFilters = { query, scope, scopeHash: scopeKey(scope), estimate };
    const row = await this.deps.db.transaction(async (tx) => {
      const created = await tx.repo.create(ctx, { id, module, filters });
      const zones = scope.kind === 'ALL' ? [null] : scope.zoneIds;
      for (const zoneId of zones) {
        await record(tx.audit, {
          module: source.audit.module,
          action: source.audit.action,
          entity: { type: 'export', id, zoneId },
          // the filters, without the free-text search: it can be a customer's name or phone (no PII in the log)
          after: {
            module,
            filters: auditFilters(query),
            zoneIds: scope.kind === 'ALL' ? 'ALL' : scope.zoneIds,
            estimate,
          },
        });
      }
      return created;
    });
    try {
      await this.deps.enqueue(id);
    } catch {
      // the row is committed: the sweep queues it again within a few minutes (QUEUED_STALE_MS)
      this.deps.log?.(`[exports] enqueue of ${id} failed; the sweep will retry it`);
    }
    return this.toJob(row);
  }

  /** GET /exports/{id}: the requester's own job only; anyone else gets 404. */
  async get(ctx: AuthContext, id: string): Promise<ExportJob> {
    const row = await this.deps.db.repo.findForRequester(ctx, id);
    if (!row) throw new AppError('NOT_FOUND', 'Not found');
    return this.toJob(row);
  }

  private async toJob(row: ExportRow): Promise<ExportJob> {
    const now = this.deps.clock();
    const expired =
      row.status === 'EXPIRED' ||
      (row.status === 'READY' && row.expiresAt !== null && row.expiresAt <= now);
    const ready =
      row.status === 'READY' && !expired && row.fileKey !== null && row.expiresAt !== null;
    const downloadUrl =
      ready && row.fileKey && row.expiresAt
        ? await this.deps.files.signedDownload(
            row.fileKey,
            this.source(row.module).filename(row.createdAt),
            (row.expiresAt.getTime() - now.getTime()) / 1000,
          )
        : null;
    const scope = row.filters.scope;
    return {
      id: row.id,
      module: row.module,
      status: expired ? 'EXPIRED' : row.status,
      zoneIds: scope.kind === 'ALL' ? null : [...scope.zoneIds],
      rowCount: row.filters.rowCount ?? row.filters.estimate,
      failureReason: row.filters.failureReason ?? null,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.status === 'READY' && row.expiresAt ? row.expiresAt.toISOString() : null,
      downloadUrl,
    };
  }

  // ---- worker ----

  /**
   * Builds the file of one job. `finalAttempt`: on an unexpected error the job is FAILED (ERROR) on the last attempt and
   * put back to QUEUED otherwise, so the queue's retry can take it again. Returns the final status, or null when the
   * job was not claimable (done already, or another worker has it).
   */
  async run(id: string, opts: { finalAttempt: boolean }): Promise<'READY' | 'FAILED' | null> {
    const repo = this.deps.db.repo;
    const now = this.deps.clock();
    const job = await repo.claim(id, now, new Date(now.getTime() - RUNNING_STALE_MS));
    if (!job) return null;
    const fail = async (reason: ExportFailureReason) => {
      await repo.markFailed(id, { ...job.filters, failureReason: reason });
      return 'FAILED' as const;
    };
    try {
      const source = this.source(job.module);
      const ctx = await this.currentContext(job);
      if (!ctx) return await fail('SCOPE_CHANGED');
      let scopeNow;
      try {
        scopeNow = exportScope(ctx, source.viewKey);
      } catch {
        return await fail('SCOPE_CHANGED');
      }
      if (!sameScope(scopeNow, job.filters.scope)) return await fail('SCOPE_CHANGED');

      const names = await repo.zoneNames();
      const parts: string[] = [CSV_BOM, source.header()];
      let rows = 0;
      for await (const chunk of source.chunks(ctx, job.filters.query, {
        zoneName: (z) => names.get(z) ?? z,
      })) {
        rows += chunk.rows;
        if (rows > EXPORT_MAX_ROWS) return await fail('TOO_MANY_ROWS');
        parts.push(chunk.csv);
      }
      const key = exportFileKey(id, job.createdAt);
      await this.deps.files.put(key, parts.join(''), 'text/csv; charset=utf-8');
      const done = this.deps.clock();
      await repo.markReady(id, {
        fileKey: key,
        expiresAt: new Date(done.getTime() + EXPORT_TTL_HOURS * 3_600_000),
        filters: { ...job.filters, rowCount: rows },
      });
      return 'READY';
    } catch (err) {
      if (opts.finalAttempt) return await fail('ERROR');
      await repo.requeue(id);
      throw err;
    }
  }

  /** The requester's context today, limited to the zones the job was created for; null when it no longer exists. */
  private async currentContext(job: ExportRow): Promise<AuthContext | null> {
    if (!this.deps.contexts) throw new Error('ExportsService.run needs contexts (worker)');
    const who = await this.deps.db.repo.requester(job.requestedBy);
    if (!who?.active) return null;
    try {
      return await this.deps.contexts.buildContext(
        { userId: job.requestedBy, role: who.role },
        requestedZonesOf(job.filters.scope),
      );
    } catch (err) {
      if (err instanceof AppError && err.code === 'ZONE_NOT_FOUND') return null; // a zone was unassigned since
      throw err;
    }
  }

  /** Housekeeping: files past their 24 h are deleted (status EXPIRED); jobs whose enqueue was lost are queued again. */
  async sweep(): Promise<{ expired: number; requeued: number }> {
    const repo = this.deps.db.repo;
    const now = this.deps.clock();
    let expired = 0;
    for (const r of await repo.expiredReady(now, 100)) {
      if (r.fileKey) await this.deps.files.remove(r.fileKey);
      await repo.markExpired(r.id);
      expired += 1;
    }
    const stale = await repo.staleQueued(new Date(now.getTime() - QUEUED_STALE_MS), 100);
    for (const id of stale) await this.deps.enqueue(id);
    return { expired, requeued: stale.length };
  }
}
