import type { CustomerSource, CustomerStatus } from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// M09 Customers (D14, D25, D26, D28, D63, D158; owner confirmed B1 on 2026-10-20): labels, list tabs and URL filters,
// pure so the tests check them without a browser. Customers are shared across zones; a Zonal Admin sees those with an
// address or an order in their zones, and the order figures are limited to those zones (D25).

export const customersPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/customers' : '/zone/customers';

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
};
export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, BadgeTone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  BLOCKED: 'danger',
};

export const SOURCE_LABEL: Record<CustomerSource, string> = {
  APP: 'Customer app',
  ADMIN: 'Added by an admin',
  REFERRAL: 'Referral',
  OTHER: 'Other',
  IMPORT: 'Imported',
};
/** The stored source may be null (old rows) or a value this screen does not know yet. */
export const sourceLabel = (s: string | null): string =>
  s === null ? '—' : ((SOURCE_LABEL as Readonly<Record<string, string>>)[s] ?? s);

/** List tabs: each maps to one status filter and one count from meta.counts. */
export const CUSTOMER_TABS = [
  { id: 'all', label: 'All', count: 'total', status: undefined },
  { id: 'active', label: 'Active', count: 'active', status: 'ACTIVE' },
  { id: 'inactive', label: 'Inactive', count: 'inactive', status: 'INACTIVE' },
  { id: 'blocked', label: 'Blocked', count: 'blocked', status: 'BLOCKED' },
] as const satisfies readonly {
  id: string;
  label: string;
  count: 'total' | 'active' | 'inactive' | 'blocked';
  status: CustomerStatus | undefined;
}[];
export type CustomerTabId = (typeof CUSTOMER_TABS)[number]['id'];
export const customerTabFromParam = (raw: string | null): CustomerTabId =>
  CUSTOMER_TABS.find((t) => t.id === raw)?.id ?? 'all';

export const CUSTOMER_SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
] as const;
export const customerSortFromParam = (raw: string | null): string =>
  CUSTOMER_SORTS.find((s) => s.value === raw)?.value ?? '-createdAt';

/** The source filter (?source=): only the known sources. */
export const sourceFromParam = (raw: string | null): CustomerSource | undefined =>
  (Object.keys(SOURCE_LABEL) as CustomerSource[]).find((s) => s === raw);
