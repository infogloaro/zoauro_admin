/**
 * Permission keys for Third-Party Partners (task: Third-Party Partners page).
 *
 * A third-party provider is an external delivery company/service — a distinct
 * module from own delivery partners (`delivery:*`), so it carries its own
 * `providers:*` namespace. Route → action mapping mirrors the M10 module:
 *
 *   GET    /third-party-providers                        providers:view
 *   POST   /third-party-providers                        providers:add
 *   PATCH  /third-party-providers/{id}                   providers:edit
 *   POST   /third-party-providers/{id}/status            providers:status
 *
 * Enforcement today is role-based (see `third-party-provider.scope.ts`) until
 * SA-1.7 resolves grants per member per zone. No DELETE route exists, so no
 * `providers:delete` key is declared.
 */
export const THIRD_PARTY_PROVIDER_PERMISSIONS = {
  view: 'providers:view',
  add: 'providers:add',
  edit: 'providers:edit',
  status: 'providers:status',
} as const;

export type ThirdPartyProviderPermission =
  (typeof THIRD_PARTY_PROVIDER_PERMISSIONS)[keyof typeof THIRD_PARTY_PROVIDER_PERMISSIONS];
