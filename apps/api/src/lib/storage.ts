import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

/**
 * Object storage adapter (doc 06 §storage, doc 11 Uploads): Amazon S3 with an
 * S3-compatible endpoint locally (MinIO via docker-compose.dev.yml).
 *
 * Documents are private (doc 11): the browser receives a short-lived pre-signed
 * PUT to upload and a short-lived signed GET to preview; nothing is public and
 * every download passes through an audited API call (doc 15 §retention).
 * Signing is local — no network round trip — so presign works without MinIO
 * running; only `headObject` (upload confirm) reaches the endpoint.
 */

/** Presigned PUT validity for the browser upload (doc 11 flow). */
export const PRESIGN_UPLOAD_TTL_SEC = 300;
/** Short-lived read URLs (doc 11, doc 15: "short-lived signed URLs"). */
export const PRESIGN_READ_TTL_SEC = 300;

let client: S3Client | undefined;

function s3(): S3Client {
  if (client === undefined) {
    const { S3_REGION, S3_ENDPOINT } = env();
    client = new S3Client({
      region: S3_REGION,
      // Custom endpoints (MinIO, other S3-compatible stores) use path-style
      // addressing; AWS S3 keeps its default virtual-host style.
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
    });
  }
  return client;
}

/** Test seam: drops the cached client so a new config is picked up. */
export function resetStorageClient(): void {
  client = undefined;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string;
}

/** Pre-signed PUT for `key`; the client must send the same Content-Type header. */
export async function presignUpload(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env().S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), command, { expiresIn: PRESIGN_UPLOAD_TTL_SEC });
}

/** Short-lived signed GET for a private object. */
export async function presignRead(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key });
  return getSignedUrl(s3(), command, { expiresIn: PRESIGN_READ_TTL_SEC });
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/** True when the object exists (upload confirm, doc 11 step 4). */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return {
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** First `length` bytes of an object — content sniffing (doc 13 T9, TC-UPL-1). */
export async function readHeadBytes(key: string, length: number): Promise<Buffer> {
  const res = await s3().send(
    new GetObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      Range: `bytes=0-${length - 1}`,
    }),
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error('Object storage returned an empty body');
  return Buffer.from(bytes);
}
