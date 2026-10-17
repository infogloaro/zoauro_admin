import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Where export files live (doc 06 S3, MinIO locally). Separate from the upload port (lib/storage.ts): the server writes
// these objects itself and hands out one signed GET that lasts until the export expires (doc 09: 24 h link), where
// uploads only ever presign short browser PUTs and 5-minute reads. Keys: exports/<yyyy>/<mm>/<exportId>.csv.

export interface ExportFileStore {
  put(key: string, body: string, contentType: string): Promise<void>;
  /** signed GET that downloads as `filename`, valid for `expiresInSec` */
  signedDownload(key: string, filename: string, expiresInSec: number): Promise<string>;
  remove(key: string): Promise<void>;
}

export function exportFileKey(exportId: string, at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `exports/${y}/${m}/${exportId}.csv`;
}

/** S3 signatures last at most 7 days; ours never more than the export's own lifetime. */
const MAX_SIGNED_SEC = 7 * 24 * 3600;

export function createS3ExportFileStore(config: {
  bucket: string;
  region: string;
  endpoint?: string;
}): ExportFileStore {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  const Bucket = config.bucket;
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    signedDownload: (key, filename, expiresInSec) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        }),
        { expiresIn: Math.max(1, Math.min(MAX_SIGNED_SEC, Math.floor(expiresInSec))) },
      ),
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
