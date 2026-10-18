import type {
  MenuApprovalField,
  MenuAvailability,
  MenuChangeKind,
  MenuChangeStatus,
  MenuCounts,
  MenuVendorKind,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { formatPaise } from '../audit/format';

// Menu items (M08), Food Item Requests (R09) and categories (D119, D124–D127), ported from Chittra Priya's menu screens
// onto the core: labels, list tabs, bulk price maths for the preview text, and change-request field formatting. Pure.

export const AVAILABILITY_LABEL: Record<MenuAvailability, string> = {
  live: 'Live',
  out_of_stock: 'Out of stock',
  vendor_off: 'Turned off by vendor',
  admin_disabled: 'Disabled by admin',
};
export const AVAILABILITY_TONE: Record<MenuAvailability, BadgeTone> = {
  live: 'success',
  out_of_stock: 'warning',
  vendor_off: 'neutral',
  admin_disabled: 'danger',
};
export const VENDOR_KIND_LABEL: Record<MenuVendorKind, string> = {
  RESTAURANT: 'Restaurant',
  HOMEMAKER: 'Home Food',
};

export const MENU_TABS = [
  { id: 'all', label: 'All', count: 'total', availability: null, pending: false },
  { id: 'live', label: 'Live', count: 'live', availability: 'live', pending: false },
  {
    id: 'stock',
    label: 'Out of stock',
    count: 'outOfStock',
    availability: 'out_of_stock',
    pending: false,
  },
  {
    id: 'vendor',
    label: 'Turned off by vendor',
    count: 'vendorOff',
    availability: 'vendor_off',
    pending: false,
  },
  {
    id: 'disabled',
    label: 'Disabled by admin',
    count: 'adminDisabled',
    availability: 'admin_disabled',
    pending: false,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  count: keyof MenuCounts;
  availability: MenuAvailability | null;
  pending: boolean;
}[];
export type MenuTabId = (typeof MENU_TABS)[number]['id'];
export const menuTabFromParam = (raw: string | null): MenuTabId =>
  MENU_TABS.find((t) => t.id === raw)?.id ?? 'all';

export const CHANGE_KIND_LABEL: Record<MenuChangeKind, string> = {
  CREATE: 'New item',
  UPDATE: 'Change',
  DELETE: 'Remove item',
};
export const CHANGE_STATUS_LABEL: Record<MenuChangeStatus, string> = {
  PENDING: 'Waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Replaced by a newer request',
};
export const CHANGE_STATUS_TONE: Record<MenuChangeStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
};
export const FIELD_LABEL: Record<MenuApprovalField, string> = {
  name: 'Name',
  description: 'Description',
  price: 'Price',
  categoryId: 'Category',
  dietary: 'Dietary',
  imageKey: 'Photo',
};

/** One change-request value as text: prices in rupees, categories by name, photos as "new photo". */
export function fieldText(
  field: MenuApprovalField,
  value: string | number | boolean | null,
  categoryName: (id: string) => string | undefined,
): string {
  if (value === null || value === '') return '—';
  if (field === 'price' && typeof value === 'number') return formatPaise(value);
  if (field === 'categoryId' && typeof value === 'string')
    return categoryName(value) ?? 'Another category';
  if (field === 'imageKey') return 'Photo attached';
  if (field === 'dietary')
    return value === 'VEGETARIAN'
      ? 'Vegetarian'
      : value === 'NON_VEG'
        ? 'Non-veg'
        : value === 'EGG'
          ? 'Egg'
          : String(value);
  return String(value);
}

/** Bulk price: the new price for the preview text (the API computes the real one, rounding half-up). */
export function bulkPrice(price: number, mode: 'percent' | 'amount', value: number): number {
  return mode === 'percent' ? Math.round(price * (1 + value / 100)) : price + value;
}
