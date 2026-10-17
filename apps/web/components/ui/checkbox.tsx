import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded-[--radius-input] border border-border accent-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
