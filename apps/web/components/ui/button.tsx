import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style Button on the design tokens (doc 19). Variants: primary (one per view, orange), secondary (outlined),
// soft (orange tint), ghost, danger. Sizes: sm, md (default), icon.

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
  secondary: 'border border-line bg-surface text-text shadow-sm hover:bg-surface-muted',
  soft: 'bg-primary-soft text-primary-strong hover:bg-orange-100',
  ghost: 'text-primary-strong hover:bg-primary-soft',
  danger: 'bg-danger text-white shadow-sm hover:opacity-90',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  icon: 'size-10 p-0',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export const buttonClass = (
  variant: ButtonVariant = 'primary',
  className?: string,
  size: ButtonSize = 'md',
): string =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-input font-medium whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    'disabled:cursor-not-allowed disabled:opacity-60',
    SIZES[size],
    VARIANTS[variant],
    className,
  );

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, className, size)} {...props} />
  );
});
