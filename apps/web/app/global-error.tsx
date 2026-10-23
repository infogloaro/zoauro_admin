'use client';

import { useEffect } from 'react';
import { reloadOnceForChunkError, sessionStore } from '../lib/chunk-reload';
import './globals.css';

// An error in the root layout itself (doc 19 section 4): the app's own error page cannot render, so this replaces the
// whole document. A chunk that failed to load reloads the page once (lib/chunk-reload); anything else offers a reload.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reloadOnceForChunkError(error, sessionStore(), () => window.location.reload());
  }, [error]);
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-bg p-4">
        <main id="main" className="mx-auto mt-24 max-w-md text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            The page could not be loaded. Reload it; if it keeps happening, tell support
            {error.digest ? ` the reference ${error.digest}` : ''}.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-input bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
