import { paiseToRupees } from '@zoauro/shared';

// Display rules for audit rows (doc 50 section 9.3): times in the configured timezone (Asia/Kolkata by default),
// Indian number format, money stored as integer paise shown as rupees.

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/**
 * Fields that hold integer paise. The audit diff carries no type information, so money is recognised by the last
 * segment of the field path. The names are the integer money columns of apps/api/prisma/schema.prisma (doc 08);
 * a new money column must be added here, or its diff shows as a plain number. Counts such as amountMismatch are not money.
 */
export const MONEY_FIELDS: ReadonlySet<string> = new Set([
  'amount',
  'amountTotal',
  'cashInHand',
  'commissionAmount',
  'credit',
  'dailyRefund',
  'dailyRefundLimit',
  'debit',
  'defaultDailyRefundLimit',
  'defaultPerRefundLimit',
  'deliveryCharge',
  'discount',
  'expectedAmount',
  'gross',
  'handedInAmount',
  'minOrder',
  'perRefund',
  'perRefundLimit',
  'price',
  'priceSnapshot',
  'subtotal',
  'tax',
  'variance',
  'walletBalance',
]);

export const isMoneyField = (path: string): boolean =>
  MONEY_FIELDS.has(path.split('.').pop() ?? path);

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const plainNumber = new Intl.NumberFormat('en-IN');

/** 123456 paise -> "₹1,234.56"; 12345678 -> "₹1,23,456.78". */
export const formatPaise = (paise: number): string => rupees.format(paiseToRupees(paise));

/** One diff cell. Absent and null are "—"; money fields holding integers are rupees; everything else is plain. */
export function formatValue(path: string, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number') {
    if (isMoneyField(path) && Number.isInteger(value)) return formatPaise(value);
    return plainNumber.format(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  return JSON.stringify(value);
}

/** "hours.close" -> "Hours › Close", "commissionPct" -> "Commission pct". */
export function fieldLabel(path: string): string {
  return path
    .split('.')
    .map((seg) => {
      const words = seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(' › ');
}

/** "12 Oct 2026, 3:45 pm" in the given timezone. */
export function formatTimestamp(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
