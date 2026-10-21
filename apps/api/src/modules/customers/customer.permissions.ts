/**
 * Permission keys for M09 Customers (doc 04 §3 matrix "Customers",
 * doc 05 `module:action`, doc 09 `/customers` catalogue).
 *
 * `customers:reveal` is the audited-unmask key (docs 04, 39 §W12, 40) —
 * doc 09 lists `customers:view` on the reveal row, a conflict logged in
 * doc 32 and the handoff; docs 04/39/40 win because they define the flag.
 *
 * Routes declare their key here; enforcement today is role-based (see
 * `customer.scope.ts`) until SA-1.7 resolves grants per member per zone.
 * No DELETE route exists (doc 09 lists none), so there is no `customers:delete`
 * route key even though the doc 04 matrix carries the column.
 */
export const CUSTOMER_PERMISSIONS = {
  view: 'customers:view',
  add: 'customers:add',
  edit: 'customers:edit',
  status: 'customers:status',
  reveal: 'customers:reveal',
} as const;

export type CustomerPermission = (typeof CUSTOMER_PERMISSIONS)[keyof typeof CUSTOMER_PERMISSIONS];
