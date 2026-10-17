import { randomUUID } from 'node:crypto';
import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  PDF_CONTENT_TYPE,
  type UploadConfirmInput,
  type UploadConfirmResponse,
  type UploadPresignInput,
  type UploadPresignResponse,
} from '@zoauro/shared';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import * as storage from '../../lib/storage';
import * as vendorRepo from '../vendors/vendor.repository';

/**
 * Uploads service (doc 09 `/uploads`, doc 11 Uploads, doc 13 T9):
 *
 *   presign → validate purpose/type/size allow-list + entity zone →
 *   build private key `zone/{zoneId}/{entity}/{uuid}.{ext}` → signed PUT URL
 *   confirm → object exists + stored type/size still allow-listed + magic-byte
 *   sniff (TC-UPL-1: a renamed `.exe` must not pass as `.jpg`)
 *
 * `assertUploadedObject` is the shared gate every caller of a `fileKey`
 * (confirm, document attach) must pass, so a never-uploaded or disguised file
 * can never become a `vendor_documents` row.
 */

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_KEY_RE = new RegExp(
  `^zone/(${UUID_PATTERN})/(${UUID_PATTERN})/(${UUID_PATTERN})\\.([a-z0-9]+)$`,
);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'png', 'webp', 'pdf']);

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  [PDF_CONTENT_TYPE]: 'pdf',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ParsedFileKey {
  zoneId: string;
  entityId: string;
  ext: string;
}

/** Parses the documented key shape; anything else is invalid input (doc 11). */
export function parseFileKey(fileKey: string): ParsedFileKey | null {
  const match = FILE_KEY_RE.exec(fileKey);
  if (!match) return null;
  const [, zoneId, entityId, , ext] = match;
  if (!zoneId || !entityId || !ext || !ALLOWED_EXTENSIONS.has(ext)) return null;
  return { zoneId, entityId, ext };
}

/** Content-Type without parameters, lowercased (`image/JPEG; charset=utf-8`). */
function normalizeContentType(raw: string): string {
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}

/** Size cap for an allow-listed type, or null when the type is rejected. */
function maxBytesFor(contentType: string): number | null {
  if ((IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) return MAX_IMAGE_BYTES;
  if (contentType === PDF_CONTENT_TYPE) return MAX_PDF_BYTES;
  return null;
}

function sizeLimitMessage(maxBytes: number): string {
  return `File must be at most ${Math.round(maxBytes / 1024 / 1024)} MB`;
}

function matchesMagic(contentType: string, bytes: Buffer): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return bytes.length >= 8 && PNG_SIGNATURE.equals(bytes.subarray(0, 8));
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP'
      );
    case PDF_CONTENT_TYPE:
      return bytes.length >= 4 && bytes.toString('ascii', 0, 4) === '%PDF';
    default:
      return false;
  }
}

/**
 * The entity must exist and live in the zone the key claims — a cross-zone or
 * unknown entity answers 404 (AGENTS.md scope rules).
 */
async function requireEntity(entityId: string, zoneId: string): Promise<void> {
  const row =
    (await vendorRepo.findVendor('restaurant', entityId)) ??
    (await vendorRepo.findVendor('homemaker', entityId));
  if (!row || row.zoneId !== zoneId) throw errors.notFound('Vendor not found');
}

export async function presignUpload(
  ctx: AuthContext,
  input: UploadPresignInput,
): Promise<UploadPresignResponse> {
  // Partner documents belong to the delivery-partner module (not built yet);
  // without its table the entity cannot be validated, so refuse rather than
  // sign an unscoped key.
  if (input.purpose === 'PARTNER_DOC') {
    throw errors.validation(
      [{ issue: 'Partner document uploads arrive with the delivery-partner module' }],
      'Unsupported upload purpose',
    );
  }

  const contentType = normalizeContentType(input.contentType);
  const maxBytes = maxBytesFor(contentType);
  if (maxBytes === null) {
    throw errors.validation(
      [{ field: 'contentType', issue: 'Only JPEG, PNG, WebP images or PDF files are allowed' }],
      'Unsupported content type',
    );
  }
  if (input.sizeBytes > maxBytes) {
    throw errors.validation(
      [{ field: 'sizeBytes', issue: sizeLimitMessage(maxBytes) }],
      'File is too large',
    );
  }

  await requireEntity(input.entityId, input.zoneId);

  const ext = EXT_BY_CONTENT_TYPE[contentType];
  const fileKey = `zone/${input.zoneId}/${input.entityId}/${randomUUID()}.${ext}`;
  const uploadUrl = await storage.presignUpload(fileKey, contentType);
  logger.debug({ userId: ctx.userId, purpose: input.purpose, fileKey }, 'upload presigned');
  return { uploadUrl, fileKey, expiresInSec: storage.PRESIGN_UPLOAD_TTL_SEC };
}

/**
 * Full gate for a `fileKey`: shape, entity zone, existence, stored allow-list
 * and content sniffing (doc 11 step 4, doc 13 T9). Returns the stored head.
 */
export async function assertUploadedObject(fileKey: string): Promise<{
  sizeBytes: number;
  contentType: string;
}> {
  const parsed = parseFileKey(fileKey);
  if (!parsed) {
    throw errors.validation([{ field: 'fileKey', issue: 'Invalid file key' }], 'Invalid file key');
  }
  await requireEntity(parsed.entityId, parsed.zoneId);

  const head = await storage.headObject(fileKey);
  if (!head) {
    throw errors.notFound('Uploaded file not found — upload it before continuing');
  }

  const contentType = normalizeContentType(head.contentType);
  const maxBytes = maxBytesFor(contentType);
  if (maxBytes === null || EXT_BY_CONTENT_TYPE[contentType] !== parsed.ext) {
    throw errors.validation(
      [{ field: 'fileKey', issue: 'Stored file type does not match the allow-list' }],
      'Stored file is not allowed',
    );
  }
  if (head.sizeBytes > maxBytes) {
    throw errors.validation(
      [{ field: 'fileKey', issue: sizeLimitMessage(maxBytes) }],
      'Stored file is too large',
    );
  }

  const magic = await storage.readHeadBytes(fileKey, 16);
  if (!matchesMagic(contentType, magic)) {
    throw errors.validation(
      [{ field: 'fileKey', issue: 'File content does not match its declared type' }],
      'File content check failed',
    );
  }
  return { sizeBytes: head.sizeBytes, contentType };
}

export async function confirmUpload(
  ctx: AuthContext,
  input: UploadConfirmInput,
): Promise<UploadConfirmResponse> {
  const head = await assertUploadedObject(input.fileKey);
  logger.debug({ userId: ctx.userId, fileKey: input.fileKey }, 'upload confirmed');
  return { fileKey: input.fileKey, sizeBytes: head.sizeBytes, contentType: head.contentType };
}
