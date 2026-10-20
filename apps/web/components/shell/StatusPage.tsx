import type { ReactNode } from 'react';

// Full-page messages inside or outside the shell: 403, 404, error, Coming Soon, empty scope.

export function StatusPage({
  code,
  title,
  children,
  actions,
}: {
  code?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="status-title"
      className="mx-auto mt-12 max-w-xl rounded-card border border-line bg-surface p-8 text-center shadow-sm"
    >
      {code ? <p className="text-sm font-semibold tracking-wide text-muted">{code}</p> : null}
      <h1 id="status-title" className="mt-1 text-2xl font-semibold">
        {title}
      </h1>
      {children ? <div className="mt-3 text-sm text-muted">{children}</div> : null}
      {actions ? <div className="mt-6 flex justify-center gap-3">{actions}</div> : null}
    </section>
  );
}

export const linkButton =
  'inline-flex items-center rounded-input bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** The 403 component (doc 18 section 7): signed in, but this area is not for this role. */
export function Forbidden() {
  return (
    <StatusPage
      code="403"
      title="You don’t have access to this page"
      actions={
        <a href="/" className={linkButton}>
          Go to my dashboard
        </a>
      }
    >
      Your account is signed in, but this area belongs to another role. If you think you should have
      access, ask a Super Admin.
    </StatusPage>
  );
}
