import type { ReactNode } from 'react';

// The card every sign-in screen sits in (doc 20 Login): product name, a heading, an optional sub-line, the content.

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="auth-title"
      className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8"
    >
      <p className="text-sm font-semibold tracking-wide text-primary">ZOAURO Admin</p>
      <h1 id="auth-title" className="mt-2 text-2xl font-semibold text-text">
        {title}
      </h1>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      <div className="mt-6 flex flex-col gap-4">{children}</div>
      {footer ? <div className="mt-6 border-t border-line pt-4 text-sm">{footer}</div> : null}
    </section>
  );
}

export const linkClass =
  'font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
