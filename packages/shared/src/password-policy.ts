// Password policy (doc 14 section 2, doc 52 section 5 "denylist": true): at least 12 characters (the floor that cannot be
// lowered) and not a commonly used password. The denylist is local and checked into the repository (doc 56 P6): no
// network call, no third-party service. Comparison ignores case and whitespace, so "Password 1234" is caught too.

/**
 * Commonly used passwords of 12+ characters (from public breach-frequency lists) plus obvious product-specific ones.
 * Shorter entries are pointless here: the length floor already refuses them.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789123',
  '1234567890qwerty',
  '111111111111',
  '000000000000',
  '123123123123',
  '121212121212',
  '987654321098',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwertyuiopasdf',
  'qwertyuiopasdfghjkl',
  'qwerty123456',
  'qwerty1234567',
  'asdfghjkl123',
  'asdfghjkl1234',
  '1qaz2wsx3edc',
  '1q2w3e4r5t6y',
  'q1w2e3r4t5y6',
  'zaq12wsxcde3',
  'password1234',
  'password12345',
  'password123456',
  'password@123',
  'password@1234',
  'password!123',
  'passwordpassword',
  'mypassword123',
  'mypassword1234',
  'newpassword123',
  'changeme1234',
  'changemenow1',
  'letmein12345',
  'iloveyou1234',
  'welcome12345',
  'welcome@1234',
  'welcome@123456',
  'administrator',
  'administrator1',
  'administrator123',
  'admin1234567',
  'admin@123456',
  'superadmin123',
  'superadmin@123',
  'abcdefghijkl',
  'abcdefgh1234',
  'abcd12345678',
  'abc123456789',
  'football1234',
  'baseball1234',
  'princess1234',
  'sunshine1234',
  'starwars1234',
  'trustno11234',
  'whatever1234',
  'dragon123456',
  'monkey123456',
  'master123456',
  'shadow123456',
  'cricket12345',
  'india@123456',
  'india1234567',
  'iloveindia123',
  'bharat123456',
  'jaihind12345',
  'mumbai123456',
  'chennai12345',
  'bangalore123',
  'hyderabad123',
  'coimbatore123',
  'zoauro123456',
  'zoauro@12345',
  'zoauroadmin1',
  'zoauroadmin123',
  'zoauro@admin1',
  'gloaro123456',
  'gloaro@12345',
  'foodadmin123',
  'fooddelivery1',
  'fooddelivery123',
  'deliveryadmin1',
  'restaurant123',
  'zonaladmin123',
  'zonal@admin123',
] as const;

const normalise = (password: string): string => password.toLowerCase().replace(/\s+/g, '');
const DENYLIST: ReadonlySet<string> = new Set(COMMON_PASSWORDS.map(normalise));

/** A password made of one repeated character ("aaaaaaaaaaaa") is as weak as a listed one. */
const isSingleCharacter = (p: string): boolean => p.length > 0 && new Set(p).size === 1;

export function isCommonPassword(password: string): boolean {
  const n = normalise(password);
  return DENYLIST.has(n) || isSingleCharacter(n);
}
