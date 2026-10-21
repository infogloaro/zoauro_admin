'use client';

import { useQuery } from '@tanstack/react-query';
import { SEARCH_MIN_LENGTH } from '@zoauro/shared';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { RECORD_GROUPS, searchOptions } from '../../components/shell/PageSearch';
import { Badge } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useApiClient } from '../../lib/api-client';
import type { ShellRole } from '../../lib/navigation';
import { useUrlState } from '../../lib/url-state';
import { isApiError } from '../auth/errors';
import { CardError } from '../dashboard/parts';

// Global Search as a page (M18, D143): the same search as the top bar (orders, customers, restaurants, Home Food,
// delivery partners; at most five each, scoped and masked by the API), with the term in the URL (?q=) so a search can
// be shared, each group closed by "see all" into its list. Ctrl+K still opens the top-bar box from any page.

export function SearchPage({ userRole, showZone }: { userRole: ShellRole; showZone: boolean }) {
  const client = useApiClient();
  const url = useUrlState();
  const q = url.params.get('q') ?? '';
  const [text, setText] = useState(q);
  const term = q.trim();
  const searching = term.length >= SEARCH_MIN_LENGTH;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = text.trim();
      if (q !== next) url.patch({ q: next || null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, q, url]);

  const results = useQuery({
    queryKey: ['search', term],
    enabled: searching,
    queryFn: ({ signal }) =>
      client.get('/search', {
        query: { q: term, types: RECORD_GROUPS.map((g) => g.key).join(',') },
        signal,
      }),
  });
  const options = searchOptions([], searching ? results.data?.groups : undefined, userRole, term);
  const sections = [...new Set(options.map((o) => o.section))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Global Search"
        crumbs={[
          {
            label: 'Dashboard',
            href: userRole === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Global Search' },
        ]}
        description="Orders, customers, restaurants, Home Food and delivery partners you may see, in one search. Press Ctrl+K on any page for the same search in the top bar."
      />
      <label className="relative block max-w-2xl">
        <span className="sr-only">Search records</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          maxLength={100}
          className={inputClass('h-12 pl-11 text-base')}
          placeholder="Order number, name, mobile number, area or vehicle number"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {!searching ? (
        <p className="text-sm text-muted">
          Type at least {SEARCH_MIN_LENGTH} characters. Mobile numbers match in full.
        </p>
      ) : results.isError ? (
        <CardError
          what={
            isApiError(results.error, 'RATE_LIMITED')
              ? 'Search (too many searches; wait a moment)'
              : 'Search'
          }
          onRetry={() => void results.refetch()}
        />
      ) : !results.data ? (
        <p role="status" className="text-sm text-muted">
          Searching…
        </p>
      ) : sections.length === 0 ? (
        <p role="status" className="text-sm text-muted">
          Nothing matches “{term}”.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((s, i) => (
            <Card key={s} aria-labelledby={`search-group-${i}`}>
              <CardHeader id={`search-group-${i}`} title={s} />
              <CardBody>
                <ul className="flex flex-col divide-y divide-line">
                  {options
                    .filter((o) => o.section === s)
                    .map((o) => (
                      <li key={o.key} className="py-2">
                        <a
                          href={o.href}
                          className={
                            o.seeAll
                              ? 'text-sm font-medium text-primary-strong hover:underline'
                              : 'flex items-center gap-3 hover:underline'
                          }
                        >
                          {o.seeAll ? (
                            o.label
                          ) : (
                            <>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {o.label}
                                </span>
                                {o.detail ? (
                                  <span className="block truncate text-xs text-muted">
                                    {o.detail}
                                  </span>
                                ) : null}
                              </span>
                              {showZone && o.zone ? <Badge tone="neutral">{o.zone}</Badge> : null}
                            </>
                          )}
                        </a>
                      </li>
                    ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
