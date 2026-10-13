import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style Button on the design tokens (doc 19). Variants: primary (one per view), secondary, ghost, danger.

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-line bg-surface text-text hover:bg-bg',
  ghost: 'text-primary hover:bg-bg',
  danger: 'bg-danger text-white hover:opacity-90',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

export const buttonClass = (variant: ButtonVariant = 'primary', className?: string): string =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-input px-4 py-2 text-sm font-medium',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    className,
  );

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ variant = 'primary', className, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={buttonClass(variant, className)} {...props} />;
});
