import type { VendorKind } from '@zoauro/shared';

/**
 * Illustrative dataset for the Figma reference states of the Restaurants /
 * Home Food screens. Everything here is simulated demo content, rendered
 * under the "Simulated operational data" banner — never persisted and never
 * sent to the API (task: reference screenshots for M06).
 */

export interface ReferenceRow {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  zone: string;
  admin: string;
  orders: number;
  gross: string;
  commission: string;
  refunds: string;
  payout: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const RESTAURANT_ROWS: ReferenceRow[] = [
  {
    id: 'RST-1201',
    name: 'The Marina Table',
    ownerName: 'Riya Sharma',
    phone: '+91 98720 3400',
    zone: 'Anna Nagar',
    admin: 'Malik Rahman',
    orders: 382,
    gross: '₹6.8L',
    commission: '₹1.02L',
    refunds: '₹0.12L',
    payout: '₹5.66L',
    status: 'ACTIVE',
  },
  {
    id: 'RST-1202',
    name: 'Anjappar Heritage',
    ownerName: 'Haidar Ali',
    phone: '+91 98720 3401',
    zone: 'Ambattur',
    admin: 'Vijay Kumar',
    orders: 355,
    gross: '₹7.7L',
    commission: '₹1.15L',
    refunds: '₹0.15L',
    payout: '₹6.40L',
    status: 'ACTIVE',
  },
  {
    id: 'RST-1203',
    name: 'Copper Chimney',
    ownerName: 'Malik Rahman',
    phone: '+91 98720 3402',
    zone: 'Adyar',
    admin: 'Ajith Raj',
    orders: 328,
    gross: '₹8.6L',
    commission: '₹1.28L',
    refunds: '₹0.18L',
    payout: '₹7.14L',
    status: 'ACTIVE',
  },
  {
    id: 'RST-1204',
    name: 'Sangeetha Veg',
    ownerName: 'Vijay Kumar',
    phone: '+91 98720 3403',
    zone: 'KK Nagar',
    admin: 'Nisha Menon',
    orders: 301,
    gross: '₹9.5L',
    commission: '₹1.41L',
    refunds: '₹0.21L',
    payout: '₹7.88L',
    status: 'ACTIVE',
  },
  {
    id: 'RST-1205',
    name: 'Dakshin Dining',
    ownerName: 'Ajith Raj',
    phone: '+91 98720 3404',
    zone: 'T. Nagar',
    admin: 'Riya Sharma',
    orders: 274,
    gross: '₹10.4L',
    commission: '₹1.54L',
    refunds: '₹0.24L',
    payout: '₹8.62L',
    status: 'INACTIVE',
  },
  {
    id: 'RST-1206',
    name: 'Madras Spice',
    ownerName: 'Nisha Menon',
    phone: '+91 98720 3405',
    zone: 'Velachery',
    admin: 'Haidar Ali',
    orders: 247,
    gross: '₹11.3L',
    commission: '₹1.67L',
    refunds: '₹0.27L',
    payout: '₹9.36L',
    status: 'ACTIVE',
  },
];

const HOMEMAKER_NAMES = [
  "Ammamma's Kitchen",
  'Nila Home Foods',
  'Anbu Samayal',
  'Veedu Virundhu',
  "Lakshmi's Pantry",
  'Madras Meal Box',
];

const HOMEMAKER_ROWS: ReferenceRow[] = RESTAURANT_ROWS.map((row, index) => ({
  ...row,
  id: `HFP-120${index + 1}`,
  name: HOMEMAKER_NAMES[index] ?? row.name,
}));

export const REFERENCE_ROWS: Record<VendorKind, ReferenceRow[]> = {
  restaurant: RESTAURANT_ROWS,
  homemaker: HOMEMAKER_ROWS,
};

/** KPI cards (Figma): label → value + supporting caption. */
export function kpiSpec(kind: VendorKind): Array<{
  label: string;
  value: string;
  caption: string;
  captionTone: 'success' | 'muted';
}> {
  const registered =
    kind === 'restaurant'
      ? { label: 'Registered Restaurants', value: '428' }
      : { label: 'Registered Providers', value: '86' };
  const active = kind === 'restaurant' ? '356' : '73';
  return [
    { ...registered, caption: '+8 this month', captionTone: 'success' },
    { label: 'Active', value: active, caption: 'Verified businesses', captionTone: 'success' },
    { label: 'Orders', value: '12,842', caption: 'Current period', captionTone: 'muted' },
    {
      label: 'Gross Revenue',
      value: '₹48.6L',
      caption: '+12.4% growth',
      captionTone: 'success',
    },
    {
      label: 'Platform Commission',
      value: '₹7.29L',
      caption: '15% of eligible GMV',
      captionTone: 'muted',
    },
    { label: 'Refunds', value: '₹1.12L', caption: '2.3% transaction value', captionTone: 'muted' },
  ];
}

export interface PerformerRow {
  name: string;
  meta: string;
  value: string;
}

const RESTAURANT_PERFORMERS: PerformerRow[] = [
  { name: 'The Marina Table', meta: 'Anna Nagar · 120 orders', value: '₹8.4L' },
  { name: 'Anjappar Heritage', meta: 'Ambattur · 107 orders', value: '₹7.7L' },
  { name: 'Copper Chimney', meta: 'Adyar · 94 orders', value: '₹7.0L' },
  { name: 'Sangeetha Veg', meta: 'KK Nagar · 81 orders', value: '₹6.3L' },
  { name: 'Dakshin Dining', meta: 'T. Nagar · 68 orders', value: '₹5.6L' },
];

const HOMEMAKER_PERFORMERS: PerformerRow[] = [
  { name: "Ammamma's Kitchen", meta: 'Anna Nagar · 120 orders', value: '₹8.4L' },
  { name: 'Nila Home Foods', meta: 'Ambattur · 107 orders', value: '₹7.7L' },
  { name: 'Anbu Samayal', meta: 'Adyar · 94 orders', value: '₹7.0L' },
  { name: 'Veedu Virundhu', meta: 'KK Nagar · 81 orders', value: '₹6.3L' },
  { name: "Lakshmi's Pantry", meta: 'T. Nagar · 68 orders', value: '₹5.6L' },
];

export const TOP_PERFORMERS: Record<VendorKind, PerformerRow[]> = {
  restaurant: RESTAURANT_PERFORMERS,
  homemaker: HOMEMAKER_PERFORMERS,
};

/** Simulated monthly revenue-trend series (0 = bottom, 1 = top), Aug–Jan. */
export const TREND_POINTS = [
  0.32, 0.26, 0.34, 0.3, 0.42, 0.38, 0.48, 0.44, 0.56, 0.52, 0.64, 0.6, 0.72, 0.68, 0.82, 0.9,
];

export const TREND_LABELS = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'];
