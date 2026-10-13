/** Indian display formatting (doc 19 §9). */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** paise → ₹12,48,320 */
export function formatRupees(paise: number): string {
  return inr.format(Math.round(paise / 100));
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** ISO → "09 Oct 2026, 14:30" */
export function formatDateTime(iso: string): string {
  return dateFmt.format(new Date(iso)).replace(',', ',');
}
