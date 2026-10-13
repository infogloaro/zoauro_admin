import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-[--radius-input] border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-muted focus:border-nav-active focus:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-[--radius-input] border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-nav-active focus:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
