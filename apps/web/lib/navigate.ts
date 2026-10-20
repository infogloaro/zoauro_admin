/**
 * A full page load (not a client-side transition): used after signing in or out so the server layouts check the new
 * session from scratch. One function, so tests can replace it.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
