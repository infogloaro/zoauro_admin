import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// Status chip (doc 19: green / orange / red / neutral / blue). The label is always text, never colour alone; `dot` adds
// a leading dot in the tone's colour.

const TONES = {
  neutral: 'bg-neutral-100 text-neutral-700',
  success: 'bg-success-soft text-success ring-1 ring-green-200',
  warning: 'bg-warning-soft text-warning ring-1 ring-amber-200',
  danger: 'bg-danger-soft text-danger ring-1 ring-red-200',
  info: 'bg-info-soft text-info ring-1 ring-blue-200',
  brand: 'bg-primary-soft text-primary-strong ring-1 ring-orange-200',
} as const;

const DOTS = {
  neutral: 'bg-neutral-400',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  brand: 'bg-primary',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'span'> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[tone])} /> : null}
      {children}
    </span>
  );
}
