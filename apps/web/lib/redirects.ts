// Where the app may send a visitor after signing in. Pure helpers, shared by the server guards (server-session.ts) and
// the sign-in screens (client components), so both apply the same rule.

/** Only our own areas may be a ?next= target: never another site, never a protocol-relative URL. */
export function safeNext(path: string | null | undefined): string | null {
  if (!path) return null;
  return !path.includes('..') &&
    /^\/(super-admin|zone|account|coming-soon)(\/[A-Za-z0-9/_\-.]*)?$/.test(path)
    ? path
    : null;
}

export const loginUrl = (path: string): string => {
  const next = safeNext(path);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
};

/** The forced first-login password change (doc 52 section 2.1 [3]): a restricted session sees only this screen. */
export const CHANGE_PASSWORD_PATH = '/change-password';

/**
 * After a successful sign-in (doc 52 section 2.1): a pending password change comes first, then the page the visitor asked
 * for (?next=), otherwise the role's home that the API chose.
 */
export function afterSignIn(
  result: { redirect: string; mustChangePassword: boolean },
  next: string | null | undefined,
): string {
  if (result.mustChangePassword) return CHANGE_PASSWORD_PATH;
  return safeNext(next) ?? (safeNext(result.redirect) ? result.redirect : '/');
}
