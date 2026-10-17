/**
 * Permission keys for the Menu & Food Items module (task: Menu & Food Items;
 * doc 04 §3 `menu:*`, doc 09 `/menu-items` catalogue).
 *
 * Routes declare their key here; enforcement today is role-based (see
 * `menu.scope.ts`) until SA-1.7 resolves grants per member per zone.
 */
export const MENU_PERMISSIONS = {
  view: 'menu:view',
  add: 'menu:add',
  edit: 'menu:edit',
  delete: 'menu:delete',
  status: 'menu:status',
} as const;

export type MenuPermission = (typeof MENU_PERMISSIONS)[keyof typeof MENU_PERMISSIONS];
