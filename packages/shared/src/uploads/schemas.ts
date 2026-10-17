import { z } from 'zod';

// Upload contracts (doc 09 /uploads, doc 11 Uploads, doc 13 T9, D120). The panel presign body extends the intake
// PresignRequest (doc 42) with `zoneId` and `entityId`, because the documented private key
// `zone/{zoneId}/{entityId}/{uuid}.{ext}` needs them. Ported from Chittra Priya's branch.

/** Purposes from the intake contract (doc 42); the panel signs VENDOR_DOC and MENU_IMAGE. */
export const UPLOAD_PURPOSES = ['VENDOR_DOC', 'PARTNER_DOC', 'MENU_IMAGE'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Doc 11 / doc 34 SA-2.1: 5 MB images, 10 MB PDFs. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Allow-listed media types (doc 11, doc 13 T9). */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PDF_CONTENT_TYPE = 'application/pdf';

/** POST /uploads/presign */
export const uploadPresignSchema = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    contentType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().positive().max(MAX_PDF_BYTES),
    zoneId: z.uuid('Choose a zone'),
    /** the vendor (restaurant or homemaker) the file belongs to */
    entityId: z.uuid(),
  })
  .strict();
export type UploadPresignInput = z.infer<typeof uploadPresignSchema>;

/** POST /uploads/confirm */
export const uploadConfirmSchema = z
  .object({ fileKey: z.string().trim().min(1).max(512) })
  .strict();
export type UploadConfirmInput = z.infer<typeof uploadConfirmSchema>;

export const uploadPresignResponseSchema = z.object({
  /** PUT the file here with the same Content-Type header; valid for expiresInSec */
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
