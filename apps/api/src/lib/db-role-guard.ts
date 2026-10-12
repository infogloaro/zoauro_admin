// Boot guard (P3.4): after connecting, the API checks which role it really is. `current_user` must be the role named in
// DATABASE_URL and one of DATABASE_ALLOWED_ROLES (default zoauro_app); otherwise the process refuses to start. The
// messages name roles only, never a password, host or connection string.

export class DatabaseRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseRoleError';
  }
}

/** The user name in a postgresql:// URL ('' when it cannot be read). Nothing else of the URL leaves this function. */
export function roleInUrl(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).username);
  } catch {
    return '';
  }
}

export async function assertDatabaseRole(deps: {
  /** runs `select current_user` on the application connection */
  currentRole: () => Promise<string>;
  databaseUrl: string;
  allowedRoles: readonly string[];
}): Promise<string> {
  const expected = roleInUrl(deps.databaseUrl);
  const actual = await deps.currentRole();
  if (actual !== expected) {
    throw new DatabaseRoleError(
      `database role check failed: connected as "${actual}" but DATABASE_URL names "${expected}"`,
    );
  }
  if (!deps.allowedRoles.includes(actual)) {
    throw new DatabaseRoleError(
      `database role check failed: "${actual}" is not an allowed application role (DATABASE_ALLOWED_ROLES: ${deps.allowedRoles.join(', ')})`,
    );
  }
  return actual;
}
