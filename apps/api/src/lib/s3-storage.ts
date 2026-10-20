import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from './errors';
import { PRESIGN_READ_TTL_SEC, PRESIGN_UPLOAD_TTL_SEC, type ObjectStorage } from './storage';

// S3 adapter of the object storage port (doc 06, D122): Amazon S3 in production, MinIO locally (docker-compose.dev.yml).
// Credentials come from the SDK's default chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or the task role), never
// from code. Signing is local, so presign works without the endpoint; head and readHead reach it. Ported from Chittra
// Priya's branch.

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/**
 * Missing credentials, an unreachable endpoint or a missing bucket are not the caller's fault: 503 with a plain message
 * instead of an unhandled 500. Only the error class name is logged (doc 13), never keys or object names.
 */
const UNAVAILABLE = new Set([
  'CredentialsProviderError',
  'NoSuchBucket',
  'TimeoutError',
  'ECONNREFUSED',
  'ENOTFOUND',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
]);
function unavailable(error: unknown): never {
  const e = error as { name?: string; code?: string };
  const kind = e.code ?? e.name ?? 'unknown';
  if (UNAVAILABLE.has(kind) || UNAVAILABLE.has(e.name ?? '')) {
    console.error(`object storage unavailable ${kind}`);
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'File storage is not available right now. Try again later.',
    );
  }
  throw error;
}
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return unavailable(error);
  }
}

export function createS3Storage(config: {
  bucket: string;
  region: string;
  /** S3-compatible endpoint (MinIO): path-style addressing */
  endpoint?: string;
}): ObjectStorage {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  const Bucket = config.bucket;
  return {
    presignUpload: (key, contentType) =>
      guarded(() =>
        getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
          expiresIn: PRESIGN_UPLOAD_TTL_SEC,
        }),
      ),
    presignRead: (key) =>
      guarded(() =>
        getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
          expiresIn: PRESIGN_READ_TTL_SEC,
        }),
      ),
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          sizeBytes: res.ContentLength ?? 0,
          contentType: res.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        return unavailable(error);
      }
    },
    async readHead(key, length) {
      const res = await guarded(() =>
        client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${length - 1}` })),
      );
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error('Object storage returned an empty body');
      return bytes;
    },
  };
}
