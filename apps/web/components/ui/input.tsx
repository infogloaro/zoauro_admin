import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style text input on the design tokens. aria-invalid turns the border red; the message itself is FormField's.

export const inputClass = (className?: string): string =>
  cn(
    'w-full rounded-input border border-line bg-surface px-3 py-2 text-sm text-text placeholder:text-muted',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
    'aria-[invalid=true]:border-danger disabled:opacity-60',
    className,
  );

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={inputClass(className)} {...props} />;
  },
);
