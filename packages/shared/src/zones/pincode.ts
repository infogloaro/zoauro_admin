// Indian postal pincodes (doc 53 sections 2.3 and 3). Pure functions, shared by the API, the zone form and the resolver.

/** 6 digits, not starting with 0 (same rule as the database CHECK on serviceable_pincodes.pincode). */
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

/** A range larger than this is refused (RANGE_TOO_LARGE): it blocks 100000–999999 typos that would swallow the country. */
export const MAX_PINCODE_RANGE = 2000;

export function isValidPincode(value: string): boolean {
  return PINCODE_PATTERN.test(value);
}

/** Trim; the result must be exactly 6 digits starting 1–9, otherwise null (resolver reason INVALID_PINCODE). */
export function normalisePincode(input: string): string | null {
  const v = input.trim();
  return isValidPincode(v) ? v : null;
}

export type RangeResult =
  | { ok: true; pincodes: string[] }
  | { ok: false; error: 'INVALID_PINCODE' | 'RANGE_REVERSED' | 'RANGE_TOO_LARGE'; size?: number };

/** Every pincode from `from` to `to` inclusive, at most MAX_PINCODE_RANGE of them. */
export function expandRange(fromInput: string, toInput: string): RangeResult {
  const from = normalisePincode(fromInput);
  const to = normalisePincode(toInput);
  if (from === null || to === null) return { ok: false, error: 'INVALID_PINCODE' };
  const a = Number(from);
  const b = Number(to);
  if (a > b) return { ok: false, error: 'RANGE_REVERSED' };
  const size = b - a + 1;
  if (size > MAX_PINCODE_RANGE) return { ok: false, error: 'RANGE_TOO_LARGE', size };
  return { ok: true, pincodes: Array.from({ length: size }, (_, i) => String(a + i)) };
}

/**
 * A pasted list or CSV column: separators are commas, semicolons and any whitespace. Valid pincodes come back once each,
 * in first-seen order; everything else is reported as invalid (as typed, trimmed) so the form can show it.
 */
export function parsePincodeList(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    if (raw === '') continue;
    const p = normalisePincode(raw);
    if (p === null) invalid.push(raw);
    else if (!seen.has(p)) {
      seen.add(p);
      valid.push(p);
    }
  }
  return { valid, invalid };
}
