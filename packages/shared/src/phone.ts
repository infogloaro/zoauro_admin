// Indian mobile numbers for SMS one-time codes (doc 52 sections 2.3 and 6): the code goes only to the number on the
// member record (D72), sent in E.164 (+91 and 10 digits starting 6-9). Shown to the person only as a hint.

const MOBILE = /^[6-9]\d{9}$/;

/**
 * "+91 98765 43210", "919876543210", "09876543210" or "9876543210" -> "+919876543210"; anything else -> null.
 * Separators (spaces, hyphens, dots, brackets) are ignored.
 */
export function normaliseIndianMobile(input: string): string | null {
  let d = input.trim().replace(/[\s\-.()]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return MOBILE.test(d) ? `+91${d}` : null;
}

/** "+919876543210" -> "+91•••••••210" (doc 52 section 3: destination_hint). */
export function phoneHint(e164: string): string {
  return e164.length < 6
    ? '•••'
    : `${e164.slice(0, 3)}${'•'.repeat(e164.length - 6)}${e164.slice(-3)}`;
}
