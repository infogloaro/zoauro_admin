'use client';

import { useEffect } from 'react';
import { StatusPage, linkButton } from '../components/shell/StatusPage';
import { reloadOnceForChunkError, sessionStore } from '../lib/chunk-reload';

// Unexpected errors (doc 19 section 4). No technical detail is shown; the digest lets support find the server log. A
// chunk that failed to load (a short network drop) reloads the page once instead (lib/chunk-reload).
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reloadOnceForChunkError(error, sessionStore(), () => window.location.reload());
  }, [error]);
  return (
    <main id="main" className="min-h-screen bg-bg p-4">
      <StatusPage
        code="Error"
        title="Something went wrong"
        actions={
          <>
            <button type="button" onClick={() => retry()} className={linkButton}>
              Try again
            </button>
            <a
              href="/"
              className="inline-flex items-center rounded-input border border-line px-4 py-2 text-sm"
            >
              Go to my dashboard
            </a>
          </>
        }
      >
        The page could not be loaded. Try again; if it keeps happening, tell support
        {error.digest ? ` the reference ${error.digest}` : ''}.
      </StatusPage>
    </main>
  );
}
