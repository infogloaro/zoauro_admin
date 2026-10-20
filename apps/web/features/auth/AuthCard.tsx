import type { ReactNode } from 'react';

// The card every sign-in screen sits in (doc 20 Login; owner's prototype): the Zoauro mark and name, a heading, an
// optional sub-line, the content and an optional footer. White on the photo background of the (auth) layout.

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
      className="w-full max-w-[480px] rounded-[24px] bg-surface/[0.97] p-6 shadow-2xl ring-1 ring-black/5 sm:p-9"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="size-11 shrink-0 rounded-xl bg-white bg-no-repeat shadow-sm ring-1 ring-line"
          style={{
            backgroundImage: 'url(/brand/zoauro-logo.jpeg)',
            backgroundSize: '360% auto',
            backgroundPosition: '50% 26%',
          }}
        />
        <p className="flex flex-col leading-tight">
          <span className="text-sm font-bold tracking-wide text-text">ZOAURO Admin</span>
          <span className="text-xs text-muted">Food delivery control panel</span>
        </p>
      </div>
      <h1 id="auth-title" className="mt-6 text-[26px] font-bold tracking-tight text-text">
        {title}
      </h1>
      {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
      <div className="mt-6 flex flex-col gap-4">{children}</div>
      {footer ? <div className="mt-6 border-t border-line pt-4 text-sm">{footer}</div> : null}
    </section>
  );
}

export const linkClass =
  'font-medium text-primary-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
