import { z } from 'zod';
import { cursorMetaSchema, DEFAULT_CURSOR_LIMIT, MAX_PAGE_SIZE } from '../pagination';
import { SETTING_GROUPS } from './registry';

// Settings API contract (doc 59 §5, D109, D112). Values are validated per key against the registry on the server; here
// they are `unknown` because each key has its own schema.

const iso = z.iso.datetime();
const id = z.uuid();

export const SETTING_SOURCES = ['DEFAULT', 'PLATFORM', 'ZONE'] as const;
export const SETTING_EFFECT_STATES = ['ENFORCED', 'PENDING_MODULE', 'NOT_CONFIGURED'] as const;

export const settingGroupParamsSchema = z.object({ group: z.enum(SETTING_GROUPS) });
export const settingKeyParamsSchema = z.object({
  group: z.enum(SETTING_GROUPS),
  key: z.string().min(3).max(80),
});
export const zoneSettingGroupParamsSchema = z.object({ id, group: z.enum(SETTING_GROUPS) });
export const zoneSettingKeyParamsSchema = z.object({
  id,
  group: z.enum(SETTING_GROUPS),
  key: z.string().min(3).max(80),
});

const effectSchema = z.object({
  state: z.enum(SETTING_EFFECT_STATES),
  /** PENDING_MODULE: the module that will read it */
  module: z.string().nullable(),
});

const changedBy = z.object({ id, name: z.string() }).nullable();

/** One setting as the screens show it. */
export const settingViewSchema = z.object({
  key: z.string(),
  group: z.enum(SETTING_GROUPS),
  label: z.string(),
  description: z.string(),
  zoneOverride: z.boolean(),
  reauth: z.enum(['PASSWORD', 'STRONG']),
  /** false: changed through its own screen (security.mfa: Settings > Security) */
  editable: z.boolean(),
  default: z.unknown(),
  /** saved by a Super Admin for the whole platform; null = the default applies */
  platform: z
    .object({ value: z.unknown(), version: z.number().int(), updatedAt: iso, updatedBy: changedBy })
    .nullable(),
  /** with ?zoneId=: that zone's own value; null = none */
  zone: z
    .object({ value: z.unknown(), version: z.number().int(), updatedAt: iso, updatedBy: changedBy })
    .nullable(),
  effective: z.unknown(),
  source: z.enum(SETTING_SOURCES),
  effect: effectSchema,
});
export type SettingView = z.infer<typeof settingViewSchema>;

/** GET /settings (every key, platform view) and GET /settings/{group}?zoneId= (that zone's effective values) */
export const settingListResponseSchema = z.object({
  zoneId: id.nullable(),
  data: z.array(settingViewSchema),
});
export type SettingListResponse = z.infer<typeof settingListResponseSchema>;
export const settingGroupQuerySchema = z.object({ zoneId: id.optional() });

export const SETTING_REASON_MIN = 5;
export const SETTING_REASON_MAX = 500;
const reason = z.string().trim().min(SETTING_REASON_MIN).max(SETTING_REASON_MAX);

/**
 * PUT /settings/{group} and PUT /zones/{id}/settings/{group}: new values for one or more keys of the group, a mandatory
 * reason, and optionally the versions the screen showed (409 STALE_VERSION when someone saved in between).
 */
export const putSettingsSchema = z
  .object({
    values: z
      .record(z.string(), z.unknown())
      .refine((v) => Object.keys(v).length > 0, 'name at least one setting'),
    reason,
    versions: z.record(z.string(), z.number().int().min(0)).optional(),
  })
  .strict();
export type PutSettingsInput = z.infer<typeof putSettingsSchema>;

/** DELETE /settings/{group}/{key} (reset to default) and DELETE /zones/{id}/settings/{group}/{key} (remove override) */
export const resetSettingSchema = z.object({ reason }).strict();
export type ResetSettingInput = z.infer<typeof resetSettingSchema>;

/** POST /settings/{group}/preview: validate and diff without saving; impact of a refund-cap change. */
export const previewSettingsSchema = z
  .object({
    values: z
      .record(z.string(), z.unknown())
      .refine((v) => Object.keys(v).length > 0, 'name at least one setting'),
    zoneId: id.optional(),
  })
  .strict();
export type PreviewSettingsInput = z.infer<typeof previewSettingsSchema>;

export const settingsPreviewResponseSchema = z.object({
  zoneId: id.nullable(),
  changes: z.array(z.object({ key: z.string(), before: z.unknown(), after: z.unknown() })),
  /** refunds.limits: members whose own limit would be above the new cap (D110); they keep it until edited */
  membersAboveCap: z.array(
    z.object({
      memberId: id,
      name: z.string(),
      zoneId: id,
      zoneName: z.string(),
      perRefundPaise: z.number().int(),
      dailyRefundPaise: z.number().int(),
    }),
  ),
  /** orders.numberFormat: what the next order number would look like */
  orderNumberExample: z.string().nullable(),
});
export type SettingsPreview = z.infer<typeof settingsPreviewResponseSchema>;

/** GET /settings/history: the audit rows of module settings, newest first, cursor = last id. */
export const settingHistoryQuerySchema = z
  .object({
    key: z.string().min(3).max(80).optional(),
    group: z.enum(SETTING_GROUPS).optional(),
    zoneId: id.optional(),
    actorId: id.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_CURSOR_LIMIT),
    after: id.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type SettingHistoryQuery = z.infer<typeof settingHistoryQuerySchema>;

export const settingHistoryResponseSchema = z.object({
  data: z.array(
    z.object({
      id,
      createdAt: iso,
      action: z.string(),
      actionLabel: z.string(),
      key: z.string().nullable(),
      actor: z.object({ id: id.nullable(), name: z.string() }),
      zone: z.object({ id, name: z.string().nullable() }).nullable(),
      before: z.unknown(),
      after: z.unknown(),
      reason: z.string().nullable(),
    }),
  ),
  meta: cursorMetaSchema,
});
