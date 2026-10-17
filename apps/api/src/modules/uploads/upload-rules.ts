import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  PDF_CONTENT_TYPE,
} from '@zoauro/shared';

// Upload allow-list and content sniffing (doc 11, doc 13 T9, TC-UPL-1: a renamed .exe must not pass as .jpg). Pure, so
// it is unit-tested without storage. Ported from Chittra Priya's branch.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_KEY_RE = new RegExp(`^zone/(${UUID})/(${UUID})/(${UUID})\\.([a-z0-9]+)$`);

export const EXT_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  [PDF_CONTENT_TYPE]: 'pdf',
};
const ALLOWED_EXTENSIONS = new Set(Object.values(EXT_BY_CONTENT_TYPE));

export interface ParsedFileKey {
  zoneId: string;
  entityId: string;
  ext: string;
}

/** The documented private key `zone/{zoneId}/{entityId}/{uuid}.{ext}`; anything else is invalid input. */
export function parseFileKey(fileKey: string): ParsedFileKey | null {
  const m = FILE_KEY_RE.exec(fileKey);
  if (!m) return null;
  const [, zoneId, entityId, , ext] = m;
  if (!zoneId || !entityId || !ext || !ALLOWED_EXTENSIONS.has(ext)) return null;
  return { zoneId, entityId, ext };
}

export function fileKeyFor(
  zoneId: string,
  entityId: string,
  id: string,
  contentType: string,
): string {
  return `zone/${zoneId}/${entityId}/${id}.${EXT_BY_CONTENT_TYPE[contentType] ?? 'bin'}`;
}

/** Content-Type without parameters, lowercased (`image/JPEG; charset=utf-8` -> `image/jpeg`). */
export function normalizeContentType(raw: string): string {
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}

/** Size cap of an allow-listed type; null = the type is refused. */
export function maxBytesFor(contentType: string): number | null {
  if ((IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) return MAX_IMAGE_BYTES;
  if (contentType === PDF_CONTENT_TYPE) return MAX_PDF_BYTES;
  return null;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.subarray(from, to));

/** The first bytes match the declared type. */
export function matchesMagic(contentType: string, b: Uint8Array): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.length >= 8 && PNG.every((v, i) => b[i] === v);
    case 'image/webp':
      return b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP';
    case PDF_CONTENT_TYPE:
      return b.length >= 4 && ascii(b, 0, 4) === '%PDF';
    default:
      return false;
  }
}
