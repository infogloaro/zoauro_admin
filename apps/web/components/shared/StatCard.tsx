import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

// KPI card (prototype): icon tile, label, value and a hint line. With `href` the whole card drills down to the records
// behind the number (roadmap 4.3). `value` null shows a dash for "not measured", never an invented number.

const TILE = {
  brand: 'bg-primary-soft text-primary-strong',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-neutral-100 text-neutral-600',
} as const;

export type StatTone = keyof typeof TILE;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  href,
  loading = false,
}: {
  label: string;
  value: number | string | null;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  href?: string;
  loading?: boolean;
}) {
  const shown =
    value === null ? '—' : typeof value === 'number' ? value.toLocaleString('en-IN') : value;
  const body = (
    <>
      <span
        className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', TILE[tone])}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-muted">{label}</span>
        {loading ? (
          <span aria-hidden className="mt-1.5 h-6 w-16 animate-pulse rounded bg-neutral-200" />
        ) : (
          <span className="mt-0.5 text-2xl font-bold tracking-tight text-text">{shown}</span>
        )}
        {hint ? <span className="mt-0.5 truncate text-xs text-muted">{hint}</span> : null}
      </span>
      {href ? (
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
        />
      ) : null}
    </>
  );
  const box =
    'group flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card';
  if (loading)
    return (
      <div className={box} aria-busy="true" aria-label={`${label}: loading`}>
        {body}
      </div>
    );
  return href ? (
    <a
      href={href}
      className={cn(
        box,
        'transition-shadow hover:shadow-pop focus-visible:outline-2 focus-visible:outline-primary',
      )}
    >
      {body}
    </a>
  ) : (
    <div className={box}>{body}</div>
  );
}
