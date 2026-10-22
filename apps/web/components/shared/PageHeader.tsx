import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

// Page header (doc 19, prototype): breadcrumbs, title, one-line description and the page's actions on the right.
// Breadcrumbs keep the trail back (roadmap 4.2); the last crumb is the current page and is not a link.

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
  badge,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight aria-hidden className="size-3" /> : null}
                  {c.href ? (
                    <Link
                      href={c.href}
                      prefetch={false}
                      className="font-medium text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-text sm:text-[28px]">{title}</h1>
          {badge}
        </div>
        {/* a div, not a p: a description may hold block content (System Logs puts its related links' <nav> there) */}
        {description ? (
          <div className="mt-1.5 max-w-3xl text-sm text-muted">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
