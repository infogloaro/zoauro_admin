import type { PermissionAction, PermissionModule } from '@zoauro/shared';
import type { BadgeTone } from '../../../components/ui/badge';

// Display names for the access screens (doc 04 module list; "Home Food" is the product name of homemakers, doc 19).

const SPECIAL: Partial<Record<PermissionModule, string>> = {
  homemakers: 'Home Food',
  admins: 'Admins',
  access: 'Access control',
  delivery: 'Delivery partners',
};

export const moduleLabel = (m: PermissionModule): string =>
  SPECIAL[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

export const ACTION_LABEL: Record<PermissionAction, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  status: 'Status',
};

export const MEMBER_STATUS_TONE: Record<'ACTIVE' | 'SUSPENDED', BadgeTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'danger',
};

export const MEMBER_STATUS_LABEL: Record<'ACTIVE' | 'SUSPENDED', string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
};

export const NEVER_GRANTABLE = 'Never grantable to a Zonal Admin';
