import { z } from 'zod';
import { SETTING_GROUPS, type SettingGroup } from '../settings/registry';

// D178 (owner's final design): two panels. Zonal Admins keep the per-zone access model unchanged. Super Admins: a
// PRIMARY (one or more) holds every Control Panel area and alone creates, removes, scopes and promotes Super Admins; a
// non-primary Super Admin runs all-zone operations but only the Control Panel areas a primary granted. Fail closed: an
// area that is not granted is refused (403, detail AREA_NOT_GRANTED). The last primary can never be removed or demoted.

const SETTING_GROUP_LABEL: Record<SettingGroup, string> = {
  refunds: 'Refunds',
  onboarding: 'Onboarding documents',
  support: 'Support',
  notifications: 'Notifications',
  orders: 'Orders and dispatch',
  sms: 'SMS',
  loyalty: 'Reward points',
  security: 'Security',
  payouts: 'Payouts',
  zones: 'Zone limits',
  access: 'Access switches and record claims',
  sessions: 'Sign-in sessions',
  ads: 'Advertising',
};

/** The catalogue, in display order (GET /super-admins/areas). Settings areas follow the settings groups. */
export const CONTROL_AREAS: readonly { key: string; label: string; description: string }[] = [
  {
    key: 'zones',
    label: 'Zones',
    description: 'Create and edit zones, pincodes, services and zone teams.',
  },
  {
    key: 'access',
    label: 'Zonal Admin access',
    description: 'Zonal Admin accounts, access profiles, member access and access requests.',
  },
  { key: 'exports', label: 'Exports', description: 'Export flags and data exports.' },
  { key: 'audit', label: 'Audit log', description: 'Audit logs and sign-in history.' },
  ...SETTING_GROUPS.map((g) => ({
    key: `settings.${g}`,
    label: `Settings: ${SETTING_GROUP_LABEL[g]}`,
    description: `The ${SETTING_GROUP_LABEL[g].toLowerCase()} settings (platform values and zone overrides).`,
  })),
];
export const CONTROL_AREA_KEYS = CONTROL_AREAS.map((a) => a.key);
export const controlAreaKeySchema = z
  .string()
  .refine((k) => CONTROL_AREA_KEYS.includes(k), 'unknown Control Panel area');

const reason = z.string().trim().min(5).max(500);

/** GET /me (controlAreas) and GET /me/control-areas. null in GET /me for a Zonal Admin. */
export const controlAreasSchema = z.object({
  isPrimary: z.boolean(),
  /** every key for a primary */
  areas: z.array(z.string()),
});
export type ControlAreas = z.infer<typeof controlAreasSchema>;

export const controlAreaCatalogueResponseSchema = z.object({
  data: z.array(z.object({ key: z.string(), label: z.string(), description: z.string() })),
});

/** PUT /super-admins/{id}/areas (primary only, STRONG): the complete set for a non-primary Super Admin. */
export const putSuperAdminAreasSchema = z
  .object({
    areas: z
      .array(controlAreaKeySchema)
      .max(CONTROL_AREA_KEYS.length)
      .refine((l) => new Set(l).size === l.length, 'must not repeat an area'),
    reason,
  })
  .strict();
export type PutSuperAdminAreasInput = z.infer<typeof putSuperAdminAreasSchema>;

/** POST /super-admins/{id}/primary (primary only, STRONG): promote or demote; the last primary cannot be demoted. */
export const setSuperAdminPrimarySchema = z.object({ primary: z.boolean(), reason }).strict();
export type SetSuperAdminPrimaryInput = z.infer<typeof setSuperAdminPrimarySchema>;
