import type {
  PermissionKey,
  UploadConfirmInput,
  UploadConfirmResponse,
  UploadPresignInput,
  UploadPresignResponse,
  VendorModule,
} from '@zoauro/shared';
import { uuidv7 } from '../../lib/audit';
import { can, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { PRESIGN_UPLOAD_TTL_SEC, type ObjectStorage } from '../../lib/storage';
import {
  EXT_BY_CONTENT_TYPE,
  fileKeyFor,
  matchesMagic,
  maxBytesFor,
  normalizeContentType,
  parseFileKey,
} from './upload-rules';

// Uploads (doc 09 /uploads, doc 11, doc 13 T9, D120). Ported from Chittra Priya's branch, rebuilt on the core:
//   presign: purpose/type/size allow-list, the entity must live in the zone the request names, and the caller must be
//            able to edit it there (404 for a zone that is not theirs, 403 for a missing action) -> private key
//            zone/{zoneId}/{entityId}/{uuid}.{ext} and a 300 s signed PUT
//   confirm / assertUploaded: key shape, the same scope check, the object exists, its stored type and size are still
//            allow-listed, and its first bytes match the type. Every caller of a fileKey (confirm, document attach)
//            passes this gate, so a never-uploaded or disguised file never becomes a vendor_documents row.

/** The module that owns an upload: a vendor (documents, menu images) or a delivery partner (D131). */
export type UploadOwnerModule = VendorModule | 'delivery';

/** Who owns an entity id (unscoped, live rows only); null = not this resolver's entity. */
export interface UploadEntities {
  ownerOf(entityId: string): Promise<{ module: UploadOwnerModule; zoneId: string | null } | null>;
}

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const invalid = (field: string, issue: string, message: string) =>
  new AppError('VALIDATION_ERROR', message, [{ field, issue }]);
const sizeIssue = (max: number) => `at most ${Math.round(max / 1024 / 1024)} MB`;

export class UploadsService {
  constructor(
    private readonly deps: {
      storage: ObjectStorage;
      /** asked in order; the first that knows the id answers (vendors, then partners) */
      entities: readonly UploadEntities[];
    },
  ) {}

  private async ownerOf(
    entityId: string,
  ): Promise<{ module: UploadOwnerModule; zoneId: string | null } | null> {
    for (const e of this.deps.entities) {
      const owner = await e.ownerOf(entityId);
      if (owner) return owner;
    }
    return null;
  }

  /**
   * The entity must exist in `zoneId` and the caller must hold one of `keys` there. A zone the caller is not assigned to
   * and a cross-zone entity are 404 (doc 36); an assigned zone without the action is 403.
   */
  private async authorize(
    ctx: AuthContext,
    entityId: string,
    zoneId: string,
    keys: (module: UploadOwnerModule) => PermissionKey[],
  ): Promise<void> {
    const owner = await this.ownerOf(entityId);
    if (!owner || owner.zoneId !== zoneId) throw notFound();
    if (!ctx.isSuperAdmin && !ctx.assignedZoneIds.includes(zoneId)) throw notFound();
    const needed = keys(owner.module); // may refuse a purpose that does not fit the entity (422)
    if (ctx.isSuperAdmin) return;
    if (!needed.some((k) => can(ctx, k, zoneId)))
      throw new AppError('FORBIDDEN', 'You do not have permission to do this');
  }

  async presign(ctx: AuthContext, input: UploadPresignInput): Promise<UploadPresignResponse> {
    const contentType = normalizeContentType(input.contentType);
    const max = maxBytesFor(contentType);
    if (max === null)
      throw invalid(
        'contentType',
        'Only JPEG, PNG, WebP images or PDF files',
        'Unsupported file type',
      );
    if (input.sizeBytes > max) throw invalid('sizeBytes', sizeIssue(max), 'File is too large');
    await this.authorize(ctx, input.entityId, input.zoneId, (m) => {
      // PARTNER_DOC is for a delivery partner (D131), VENDOR_DOC and MENU_IMAGE for a vendor
      if ((input.purpose === 'PARTNER_DOC') !== (m === 'delivery'))
        throw invalid('purpose', 'wrong_entity', 'This purpose does not fit the entity');
      if (m === 'delivery') return ['delivery:edit'];
      return [input.purpose === 'MENU_IMAGE' ? 'menu:edit' : (`${m}:edit` as PermissionKey)];
    });
    const fileKey = fileKeyFor(input.zoneId, input.entityId, uuidv7(), contentType);
    const uploadUrl = await this.deps.storage.presignUpload(fileKey, contentType);
    return { uploadUrl, fileKey, expiresInSec: PRESIGN_UPLOAD_TTL_SEC };
  }

  async confirm(ctx: AuthContext, input: UploadConfirmInput): Promise<UploadConfirmResponse> {
    const head = await this.assertUploaded(ctx, input.fileKey);
    return { fileKey: input.fileKey, ...head };
  }

  /** The full gate for a fileKey; returns the stored head. */
  async assertUploaded(
    ctx: AuthContext,
    fileKey: string,
  ): Promise<{ sizeBytes: number; contentType: string }> {
    const parsed = parseFileKey(fileKey);
    if (!parsed) throw invalid('fileKey', 'invalid', 'Invalid file key');
    await this.authorize(ctx, parsed.entityId, parsed.zoneId, (m) =>
      m === 'delivery' ? ['delivery:edit'] : [`${m}:edit` as PermissionKey, 'menu:edit'],
    );
    const head = await this.deps.storage.head(fileKey);
    if (!head) throw invalid('fileKey', 'not_uploaded', 'Upload the file before continuing');
    const contentType = normalizeContentType(head.contentType);
    const max = maxBytesFor(contentType);
    if (max === null || EXT_BY_CONTENT_TYPE[contentType] !== parsed.ext)
      throw invalid('fileKey', 'type_not_allowed', 'The stored file type is not allowed');
    if (head.sizeBytes > max)
      throw invalid('fileKey', sizeIssue(max), 'The stored file is too large');
    if (!matchesMagic(contentType, await this.deps.storage.readHead(fileKey, 16)))
      throw invalid('fileKey', 'content_mismatch', 'The file content does not match its type');
    return { sizeBytes: head.sizeBytes, contentType };
  }
}
