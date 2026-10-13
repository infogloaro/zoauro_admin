import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';

// White rounded card (doc 19, prototype): the container of every section. CardHeader takes a title, an optional
// subtitle and actions on the right.

export function Card({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={cn('rounded-card border border-line bg-surface shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-text">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}
