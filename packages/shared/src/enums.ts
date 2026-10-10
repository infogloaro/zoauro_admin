export const ROLES = ['SUPER_ADMIN', 'ZONAL_ADMIN'] as const;
export type Role = (typeof ROLES)[number];
