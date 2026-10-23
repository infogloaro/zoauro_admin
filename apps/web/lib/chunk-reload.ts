// A page whose JavaScript chunk failed to load (a short network drop, e.g. through the demo tunnel, or a new build
// replacing the chunks) shows the error page although a reload would fix it. The error boundaries reload once for such
// an error; a sessionStorage flag stops a loop when the chunks really are gone.

const FLAG = 'zo-chunk-reload';
const CHUNK_ERROR =
  /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR.test(error.message);
}

/**
 * Reloads once for a chunk error: true when a reload was started. A second chunk error in the same tab within a minute
 * is left to the error page. Storage that throws (private mode, blocked) means no reload.
 */
export function reloadOnceForChunkError(
  error: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  reload: () => void,
  now: number = Date.now(),
): boolean {
  if (!isChunkLoadError(error) || !storage) return false;
  try {
    const last = Number(storage.getItem(FLAG) ?? 0);
    if (now - last < 60_000) return false;
    storage.setItem(FLAG, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/** The browser's sessionStorage, or undefined where reading it throws. */
export function sessionStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
