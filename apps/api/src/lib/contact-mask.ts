/**
 * D26 / doc 15 §privacy masking shared by the people modules (M09 Customers,
 * M10 Delivery Partners): lists and profile responses mask phone and email;
 * only an audited reveal returns them in full.
 *
 * Same rules as the vendor list masks (`vendor.service.ts`) — `98****1234`
 * for a 10-digit number, `aa***@domain` for an email. The vendor copy stays
 * where it is for now (that lane is in flight); consolidating all three is
 * logged as a tech-debt item.
 */
export function maskPhone(value: string): string {
  const plus = value.startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(Math.max(digits.length, 1));
  const stars = '*'.repeat(Math.max(1, digits.length - 6));
  return `${plus ? '+' : ''}${digits.slice(0, 2)}${stars}${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '***';
  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}

/** Applies both masks to a contact-shaped row (D26). */
export function maskContact<T extends { phone: string; email: string | null }>(dto: T): T {
  return {
    ...dto,
    phone: maskPhone(dto.phone),
    email: dto.email === null ? null : maskEmail(dto.email),
  };
}
