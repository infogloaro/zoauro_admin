/**
 * Browser-side upload flow for SA-2.1 (doc 11 "Upload flow"): validate against
 * the allow-list, presign via the API, PUT the file to object storage, then
 * confirm. The API re-validates everything on confirm and attach (doc 13 T9) —
 * these client checks only give immediate feedback in the form.
 */

import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  PDF_CONTENT_TYPE,
  type UploadConfirmResponse,
  type UploadPresignResponse,
  type UploadPurpose,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from './api';

/** Per-purpose picker limits: images 5 MB, PDF documents 10 MB (doc 11). */
export function uploadConstraints(purpose: UploadPurpose): { accept: string; maxBytes: number } {
  if (purpose === 'MENU_IMAGE') {
    return { accept: IMAGE_CONTENT_TYPES.join(','), maxBytes: MAX_IMAGE_BYTES };
  }
  return {
    accept: [...IMAGE_CONTENT_TYPES, PDF_CONTENT_TYPE].join(','),
    maxBytes: MAX_PDF_BYTES,
  };
}

function maxBytesFor(contentType: string): number {
  return contentType === PDF_CONTENT_TYPE ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

function isAllowedType(purpose: UploadPurpose, contentType: string): boolean {
  const images = IMAGE_CONTENT_TYPES as readonly string[];
  return purpose === 'MENU_IMAGE'
    ? images.includes(contentType)
    : images.includes(contentType) || contentType === PDF_CONTENT_TYPE;
}

/** Returns a user-facing problem, or null when the file passes the allow-list. */
export function validateUploadFile(purpose: UploadPurpose, file: File): string | null {
  if (!isAllowedType(purpose, file.type)) {
    return purpose === 'MENU_IMAGE'
      ? 'Choose a JPEG, PNG or WebP image.'
      : 'Choose a JPEG, PNG, WebP image or a PDF.';
  }
  if (file.size <= 0) return 'The file is empty.';
  const limit = maxBytesFor(file.type);
  if (file.size > limit) {
    return `The file is larger than ${Math.round(limit / (1024 * 1024))} MB.`;
  }
  return null;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadFileInput {
  purpose: UploadPurpose;
  zoneId: string;
  entityId: string;
  file: File;
}

/** Presign → PUT → confirm. Throws `UploadError` with a user-facing message. */
export async function uploadFile(input: UploadFileInput): Promise<{ fileKey: string }> {
  const problem = validateUploadFile(input.purpose, input.file);
  if (problem) throw new UploadError(problem);

  const presign = await apiFetch<Envelope<UploadPresignResponse>>('/uploads/presign', {
    method: 'POST',
    body: {
      purpose: input.purpose,
      contentType: input.file.type,
      sizeBytes: input.file.size,
      zoneId: input.zoneId,
      entityId: input.entityId,
    },
  });

  const put = await fetch(presign.data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': input.file.type },
    body: input.file,
  });
  if (!put.ok) {
    throw new UploadError(`The file could not be uploaded (${put.status}).`);
  }

  const confirm = await apiFetch<Envelope<UploadConfirmResponse>>('/uploads/confirm', {
    method: 'POST',
    body: { fileKey: presign.data.fileKey },
  });
  return { fileKey: confirm.data.fileKey };
}
