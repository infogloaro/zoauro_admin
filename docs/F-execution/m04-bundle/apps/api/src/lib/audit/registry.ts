// Field policy for audit JSON (doc 50 §5). One place; extend when a new sensitive column is added.
export type FieldPolicy = 'drop' | 'mask-phone' | 'mask-email' | 'mask-tail' | 'keep';

const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

const DROP_EXACT = new Set(['password', 'passwordhash', 'apikey', 'cardnumber', 'cvv', 'sessiontoken', 'authorization', 'signature', 'secretencrypted']);
const DROP_PREFIX = ['token', 'secret', 'totp', 'otp'];
// additions beyond the doc list: obvious secret-like names (clientSecret, accessToken, refreshToken, resetToken, …)
const DROP_SUFFIX = ['secret', 'token', 'password', 'passwordhash', 'apikey'];
const DROP_REGEX = [/^upi.*pin$/];

const MASK_PHONE = new Set(['phone', 'mobile', 'phonenumber', 'mobilenumber', 'alternatephone', 'contactphone']);
const MASK_EMAIL = new Set(['email', 'contactemail', 'owneremail']);
const MASK_TAIL = new Set([
  'accountnumber', 'bankaccountnumber', 'bankaccount', 'gst', 'gstnumber', 'gstin', 'pan', 'pannumber',
  'fssai', 'fssainumber', 'fssailicense', 'aadhaar', 'aadhaarnumber', 'aadharnumber',
]);

/** Secret-like names that are known to be safe to keep (e.g. counters and flags). Extend deliberately, with a reason. */
export const KEEP_ALLOWLIST = new Set(['cardlast4', 'haspassword', 'tokencount', 'otpverified', 'twofactorenabled', 'mustchangepassword', 'passwordchangedat', 'lastpasswordchangeat']);

export function classifyField(key: string): FieldPolicy {
  const n = norm(key);
  if (KEEP_ALLOWLIST.has(n)) return 'keep';
  if (DROP_EXACT.has(n) || DROP_PREFIX.some((p) => n.startsWith(p)) || DROP_SUFFIX.some((s) => n.endsWith(s)) || DROP_REGEX.some((r) => r.test(n))) return 'drop';
  if (MASK_PHONE.has(n)) return 'mask-phone';
  if (MASK_EMAIL.has(n)) return 'mask-email';
  if (MASK_TAIL.has(n)) return 'mask-tail';
  return 'keep';
}

/** Names that LOOK sensitive. The schema walker (schema-walker.ts) requires each of them to be covered: dropped, masked or allow-listed. */
export const SECRET_LIKE = /(pass(word)?|secret|token|otp|totp|api_?key|card|cvv|pin$|signature|authorization|hash|account_?number|aadhaar|aadhar|pan$|pan_?number|gst|fssai)/i;
