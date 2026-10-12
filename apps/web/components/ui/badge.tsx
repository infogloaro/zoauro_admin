import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// Status chip (doc 19: green / orange / red / neutral / blue). The label is always text, never colour alone.

const TONES = {
  neutral: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
  success: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  danger: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  info: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
