import {
  homemakerCreateSchema,
  homemakerDetailSchema,
  homemakerListResponseSchema,
  homemakerUpdateSchema,
  restaurantCreateSchema,
  restaurantDetailSchema,
  restaurantListResponseSchema,
  restaurantUpdateSchema,
  uploadConfirmResponseSchema,
  uploadConfirmSchema,
  uploadPresignResponseSchema,
  uploadPresignSchema,
  vendorContactSchema,
  vendorDocumentAttachSchema,
  vendorDocumentParamsSchema,
  vendorDocumentUrlSchema,
  vendorDocumentVerifySchema,
  vendorIdParamsSchema,
  vendorListQuerySchema,
  vendorMoveZoneSchema,
  vendorStatusSchema,
  vendorVerificationSchema,
  type AuditActionKey,
  type PermissionKey,
  type VendorModule,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// M06 Restaurants, M07 Home Food (doc 09 "same set", D120, D123) and SA-2.1 Uploads. Kept apart from operations.ts so
// the shared registration file only spreads this list. Object routes are zone 'none': the guard checks the module
// permission, the service the object's zone (404 outside the scope, 403 for a missing action in an assigned zone).

function vendorOperations(module: VendorModule): OperationDef[] {
  const restaurants = module === 'restaurants';
  const one = restaurants ? 'Restaurant' : 'Homemaker';
  const entity = restaurants ? 'restaurant' : 'homemaker';
  const label = restaurants ? 'restaurant' : 'Home Food vendor';
  const base = `/${module}`;
  const tags = [module];
  const perm = (action: string) => `${module}:${action}` as PermissionKey;
  const audit = (verb: string) => ({ module, action: `${entity}.${verb}` as AuditActionKey });
  const detail = restaurants ? restaurantDetailSchema : homemakerDetailSchema;
  const params = vendorIdParamsSchema;
  return [
    {
      operationId: `list${one}s`,
      method: 'get',
      path: base,
      tags,
      summary: `${restaurants ? 'Restaurants' : 'Home Food vendors'} in the zones the caller can view (?zoneId repeatable): filters, search q (name, phone, area), sort, pages, tab counts. Phone and email masked (D26)`,
      access: { kind: 'permission', permission: perm('view'), zone: 'query' },
      query: vendorListQuerySchema,
      response: {
        status: 200,
        schema: restaurants ? restaurantListResponseSchema : homemakerListResponseSchema,
        description: 'One page',
      },
    },
    {
      operationId: `create${one}`,
      method: 'post',
      path: base,
      tags,
      summary: `Add a ${label} in a zone (body zoneId). Refused with ZONE_SERVICE_DISABLED when the service is off there (D92); commissionPct is Super Admin only`,
      access: { kind: 'permission', permission: perm('add'), zone: 'none' },
      audit: audit('created'),
      body: restaurants ? restaurantCreateSchema : homemakerCreateSchema,
      response: {
        status: 201,
        schema: detail,
        description: 'Created (status PENDING, verification PENDING)',
      },
      errors: ['NOT_FOUND', 'ZONE_SERVICE_DISABLED'],
    },
    {
      operationId: `get${one}`,
      method: 'get',
      path: `${base}/{id}`,
      tags,
      summary: `One ${label} with its documents and the D97 checklist (null when not configured, D113). 404 outside the caller's view scope`,
      access: { kind: 'permission', permission: perm('view'), zone: 'none' },
      params,
      response: { status: 200, schema: detail, description: `The ${label}` },
      errors: ['NOT_FOUND'],
    },
    {
      operationId: `update${one}`,
      method: 'patch',
      path: `${base}/{id}`,
      tags,
      summary: `Edit the profile; the zone changes only by move-zone. commissionPct: Super Admin only (emits vendor.updated)`,
      access: { kind: 'permission', permission: perm('edit'), zone: 'none' },
      audit: audit('updated'),
      params,
      body: restaurants ? restaurantUpdateSchema : homemakerUpdateSchema,
      response: { status: 200, schema: detail, description: 'Saved' },
      errors: ['NOT_FOUND', 'CONFLICT'],
    },
    {
      operationId: `delete${one}`,
      method: 'delete',
      path: `${base}/{id}`,
      tags,
      summary: `Soft delete (PASSWORD re-auth); an active ${label} is deactivated first`,
      access: { kind: 'permission', permission: perm('delete'), zone: 'none', reauth: 'PASSWORD' },
      audit: audit('deleted'),
      params,
      response: { status: 204, description: 'Deleted' },
      errors: ['NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION'],
    },
    {
      operationId: `set${one}Status`,
      method: 'post',
      path: `${base}/{id}/status`,
      tags,
      summary:
        'Activate (only once verified), deactivate or suspend (doc 10 section 4); emits vendor.status_changed. Audited as activated, deactivated or suspended',
      access: { kind: 'permission', permission: perm('status'), zone: 'none' },
      audit: audit('activated'),
      params,
      body: vendorStatusSchema,
      response: { status: 200, schema: detail, description: 'Changed' },
      errors: ['NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION'],
    },
    {
      operationId: `verify${one}`,
      method: 'post',
      path: `${base}/{id}/verification`,
      tags,
      summary:
        'Verify or reject a pending vendor (reject needs a note); emits vendor.status_changed. Audited as verified or rejected',
      access: { kind: 'permission', permission: perm('status'), zone: 'none' },
      audit: audit('verified'),
      params,
      body: vendorVerificationSchema,
      response: { status: 200, schema: detail, description: 'Decided' },
      errors: ['NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION'],
    },
    {
      operationId: `move${one}Zone`,
      method: 'post',
      path: `${base}/{id}/move-zone`,
      tags,
      summary:
        'Move to another zone, or assign an app sign-up that has none (R-VEN-3: Super Admin, PASSWORD re-auth); emits vendor.updated',
      access: { kind: 'permission', permission: 'zones:edit', zone: 'none', reauth: 'PASSWORD' },
      audit: audit('zone_moved'),
      params,
      body: vendorMoveZoneSchema,
      response: { status: 200, schema: detail, description: 'Moved' },
      errors: ['NOT_FOUND', 'CONFLICT'],
    },
    {
      operationId: `reveal${one}Contact`,
      method: 'post',
      path: `${base}/{id}/reveal`,
      tags,
      summary:
        'The unmasked phone and email (D123): needs the reveal flag in the vendor zone (Super Admin always), audited, 30 per hour',
      access: { kind: 'permission', permission: perm('view'), zone: 'none' },
      audit: audit('contact_revealed'),
      params,
      response: { status: 200, schema: vendorContactSchema, description: 'Contact details' },
      errors: ['NOT_FOUND'],
    },
    {
      operationId: `attach${one}Document`,
      method: 'post',
      path: `${base}/{id}/documents`,
      tags,
      summary:
        'Attach a confirmed upload (POST /uploads/presign, PUT, /uploads/confirm) as a document; the key must name this vendor',
      access: { kind: 'permission', permission: perm('edit'), zone: 'none' },
      audit: audit('document_added'),
      params,
      body: vendorDocumentAttachSchema,
      response: { status: 201, schema: detail, description: 'Attached' },
      errors: ['NOT_FOUND', 'CONFLICT'],
    },
    {
      operationId: `get${one}DocumentUrl`,
      method: 'get',
      path: `${base}/{id}/documents/{docId}/url`,
      tags,
      summary: 'A 300 s signed view link (D120); every link is an audited view (document_viewed)',
      access: { kind: 'permission', permission: perm('view'), zone: 'none' },
      params: vendorDocumentParamsSchema,
      response: { status: 200, schema: vendorDocumentUrlSchema, description: 'Signed link' },
      errors: ['NOT_FOUND'],
    },
    {
      operationId: `verify${one}Document`,
      method: 'post',
      path: `${base}/{id}/documents/{docId}/verify`,
      tags,
      summary:
        'Verify or reject a pending document (reject needs a note, D120). Audited as document_verified or document_rejected',
      access: { kind: 'permission', permission: perm('status'), zone: 'none' },
      audit: audit('document_verified'),
      params: vendorDocumentParamsSchema,
      body: vendorDocumentVerifySchema,
      response: { status: 200, schema: detail, description: 'Reviewed' },
      errors: ['NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION'],
    },
  ];
}

export const VENDOR_OPERATIONS: OperationDef[] = [
  ...vendorOperations('restaurants'),
  ...vendorOperations('homemakers'),
  {
    operationId: 'presignUpload',
    method: 'post',
    path: '/uploads/presign',
    tags: ['uploads'],
    summary:
      'A 300 s pre-signed PUT for a private file of a vendor (D120: zoneId and entityId). JPEG/PNG/WebP up to 5 MB, PDF up to 10 MB; the caller must be able to edit the vendor (menu:edit for MENU_IMAGE)',
    access: { kind: 'session' },
    audit: { none: 'upload-signing' },
    body: uploadPresignSchema,
    response: { status: 200, schema: uploadPresignResponseSchema, description: 'Upload link' },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  },
  {
    operationId: 'confirmUpload',
    method: 'post',
    path: '/uploads/confirm',
    tags: ['uploads'],
    summary:
      'Checks an uploaded file: it exists, its type and size are allowed and its content matches its type (doc 13 T9)',
    access: { kind: 'session' },
    audit: { none: 'upload-signing' },
    body: uploadConfirmSchema,
    response: { status: 200, schema: uploadConfirmResponseSchema, description: 'File accepted' },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  },
];
