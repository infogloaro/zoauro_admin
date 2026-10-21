import {
  ONBOARDING_MODULES,
  onboardingItemSchema,
  onboardingListQuerySchema,
  onboardingListResponseSchema,
  onboardingMoreInfoSchema,
  onboardingRecordParamsSchema,
  type AuditActionKey,
  type PermissionKey,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// D170 vendor and hotel onboarding queue. Kept apart from operations.ts so the shared registration file only spreads
// this list.

const NOUN = { restaurants: 'Restaurant', homemakers: 'Homemaker', hotels: 'Hotel' } as const;
const ENTITY = { restaurants: 'restaurant', homemakers: 'homemaker', hotels: 'hotel' } as const;

export const ONBOARDING_OPERATIONS: OperationDef[] = [
  {
    operationId: 'listOnboarding',
    method: 'get',
    path: '/onboarding',
    tags: ['onboarding'],
    summary:
      'The onboarding queue (D170): restaurants, shops, Home Food and hotels in the zones where the caller views each module; "Needs a zone" for the Super Admin. Type, stage (default: open stages) and age tabs (24 h / 48 h), search q, oldest first',
    access: { kind: 'permission', permission: 'restaurants:view', zone: 'query' },
    query: onboardingListQuerySchema,
    response: { status: 200, schema: onboardingListResponseSchema, description: 'One page' },
  },
  ...ONBOARDING_MODULES.flatMap((m): OperationDef[] => [
    {
      operationId: `start${NOUN[m]}Review`,
      method: 'post',
      path: `/${m}/{id}/onboarding/review`,
      tags: ['onboarding'],
      summary:
        'Start the review (SUBMITTED or MORE_INFO_REQUIRED → UNDER_REVIEW) and claim the record for the reviewer (D174: 409 RECORD_CLAIMED when someone else holds it)',
      access: { kind: 'permission', permission: `${m}:status` as PermissionKey, zone: 'none' },
      audit: { module: m, action: `${ENTITY[m]}.onboarding_review_started` as AuditActionKey },
      params: onboardingRecordParamsSchema,
      response: { status: 200, schema: onboardingItemSchema, description: 'Under review' },
      errors: ['NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION', 'RECORD_CLAIMED'],
    },
    {
      operationId: `request${NOUN[m]}MoreInfo`,
      method: 'post',
      path: `/${m}/{id}/onboarding/more-info`,
      tags: ['onboarding'],
      summary:
        'Ask the vendor for more information (UNDER_REVIEW → MORE_INFO_REQUIRED, "Waiting for vendor"); the message goes to the app (onboarding.more_info_required)',
      access: { kind: 'permission', permission: `${m}:status` as PermissionKey, zone: 'none' },
      audit: { module: m, action: `${ENTITY[m]}.more_info_requested` as AuditActionKey },
      params: onboardingRecordParamsSchema,
      body: onboardingMoreInfoSchema,
      response: { status: 200, schema: onboardingItemSchema, description: 'Waiting for vendor' },
      errors: ['NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION', 'RECORD_CLAIMED'],
    },
  ]),
];
