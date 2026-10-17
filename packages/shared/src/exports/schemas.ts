import { z } from 'zod';

// Export jobs (doc 09: GET /orders/export starts a job, GET /exports/{id} reads it; D129). The CSV is built by the
// worker with the same zone scope as the list it exports (doc 36) and masked contacts (D26).

/** D129 item 1: exports.status values (stored as text, doc 08 gives none). */
export const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** Why a job failed: the requester's scope shrank before the file was written, the result was too big, or an error. */
export const EXPORT_FAILURE_REASONS = ['SCOPE_CHANGED', 'TOO_MANY_ROWS', 'ERROR'] as const;
export type ExportFailureReason = (typeof EXPORT_FAILURE_REASONS)[number];

/** Modules that can be exported through this job type (doc 09). */
export const EXPORT_MODULES = ['orders'] as const;
export type ExportModule = (typeof EXPORT_MODULES)[number];

/** The most rows one export may hold (doc 09 audit exports: 100k; the same cap for every export). */
export const EXPORT_MAX_ROWS = 100_000;
/** How long a finished file stays downloadable (doc 09: 24 h link). */
export const EXPORT_TTL_HOURS = 24;

export const exportIdParamsSchema = z.object({ id: z.uuid() });

export const exportJobSchema = z.object({
  id: z.uuid(),
  module: z.enum(EXPORT_MODULES),
  status: z.enum(EXPORT_STATUSES),
  /** the zones exported; null = every zone (Super Admin with no zone filter) */
  zoneIds: z.array(z.uuid()).nullable(),
  /** rows in the file once READY; the estimate at request time before */
  rowCount: z.number().int().min(0),
  failureReason: z.enum(EXPORT_FAILURE_REASONS).nullable(),
  createdAt: z.iso.datetime(),
  /** READY: until when downloadUrl works (24 h after the file was written) */
  expiresAt: z.iso.datetime().nullable(),
  /** READY only: signed GET of the CSV, valid until expiresAt */
  downloadUrl: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;
