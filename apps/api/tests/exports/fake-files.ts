import type { ExportFileStore } from '../../src/lib/exports';

/** In-memory export file store for the integration tests (the S3 adapter is exercised manually against MinIO). */
export function createMemoryExportFiles(): ExportFileStore & {
  files: Map<string, { body: string; contentType: string }>;
} {
  const files = new Map<string, { body: string; contentType: string }>();
  return {
    files,
    put: async (key, body, contentType) => void files.set(key, { body, contentType }),
    signedDownload: async (key, filename, expiresInSec) =>
      `memory://${key}?filename=${encodeURIComponent(filename)}&expires=${Math.round(expiresInSec)}`,
    remove: async (key) => void files.delete(key),
  };
}
