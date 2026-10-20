// Who may resolve zones (doc 42 section 1, intake.openapi.yaml x-required-scope). The intake framework (HMAC-signed
// API clients) is not built yet; when it is, it builds this from the authenticated client and maps a refusal to its own
// SCOPE_DENIED 403.

export const RESOLVE_SCOPE = 'zones:resolve';

export interface ResolveCaller {
  /** api_clients.id of the calling app */
  clientId: string;
  scopes: readonly string[];
}
