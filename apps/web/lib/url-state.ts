'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Filters live in the URL (doc 23 section 2: the URL is the source of truth, so a filtered view can be bookmarked,
// shared and survives a reload). `params` re-renders the caller when the URL changes.
//
// Two details make URL-controlled inputs feel instant:
//  - updates are shallow, through window.history.replaceState, which Next.js keeps in sync with useSearchParams.
//    router.replace would re-run the page's Server Component (a round trip, and the route guard again) first;
//  - Next applies that change inside a React transition, so for a moment useSearchParams still returns the old value
//    and a controlled checkbox or select would flick back. This hook therefore keeps its own copy of the query string,
//    updated in the same event, and follows the router only once the router has caught up with the real URL (back /
//    forward, links).

export type UrlPatch = Record<string, string | null | undefined>;

const currentSearch = (): string => window.location.search.replace(/^\?/, '');

export function useUrlState() {
  const routerSearch = useSearchParams().toString();
  const pathname = usePathname();
  const [search, setSearch] = useState(routerSearch);

  useEffect(() => {
    // an intermediate value from an earlier, superseded update is ignored: only adopt what the URL really says
    if (routerSearch === currentSearch()) setSearch(routerSearch);
  }, [routerSearch]);

  const params = useMemo(() => new URLSearchParams(search), [search]);

  const go = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      setSearch(qs);
      // `null`, not window.history.state: Next.js skips syncing calls whose data carries its own marker (__NA), and it
      // copies its internal state into the entry itself
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  /** Merge into the current URL: a string sets (the empty string too), null/undefined removes. */
  const patch = useCallback(
    (changes: UrlPatch) => {
      // read the live URL, not the render's snapshot: two quick changes must not overwrite each other
      const next = new URLSearchParams(currentSearch());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      go(next);
    },
    [go],
  );

  /** Replace the whole query string. */
  const replace = useCallback(
    (next: Record<string, string>) => go(new URLSearchParams(next)),
    [go],
  );

  return { params, patch, replace };
}
