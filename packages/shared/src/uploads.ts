import { z } from 'zod';

/**
 * Upload contracts — SA-2.1 (doc 09 `/uploads`, doc 11 Uploads, doc 34 SA-2.1,
 * doc 42 intake `PresignRequest`/`UploadConfirm`).
 *
 * The panel-side presign body extends the intake shape with `zoneId` and
 * `entityId` because the documented key `zone/{zoneId}/{entity}/{uuid}.{ext}`
 * needs them (decision row in doc 32).
 */

/** Purposes from the intake contract (doc 42); the panel uses VENDOR_DOC/MENU_IMAGE. */
export const UPLOAD_PURPOSES = ['VENDOR_DOC', 'PARTNER_DOC', 'MENU_IMAGE'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Doc 11 / doc 34 SA-2.1: 5 MB images, 10 MB PDFs. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Allow-listed media types (doc 11 "allow-list types", doc 13 T9). */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PDF_CONTENT_TYPE = 'application/pdf';

export const uploadPresignSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(MAX_PDF_BYTES),
  zoneId: z.uuid('Choose a zone'),
  entityId: z.uuid(),
});
export type UploadPresignInput = z.infer<typeof uploadPresignSchema>;

export const uploadConfirmSchema = z.object({
  fileKey: z.string().trim().min(1).max(512),
});
export type UploadConfirmInput = z.infer<typeof uploadConfirmSchema>;

export const uploadPresignResponseSchema = z.object({
  uploadUrl: z.string(),
  fileKey: z.string(),
  expiresInSec: z.number().int(),
});
export type UploadPresignResponse = z.infer<typeof uploadPresignResponseSchema>;

export const uploadConfirmResponseSchema = z.object({
  fileKey: z.string(),
  sizeBytes: z.number().int(),
  contentType: z.string(),
});
export type UploadConfirmResponse = z.infer<typeof uploadConfirmResponseSchema>;
