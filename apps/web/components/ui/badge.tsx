import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const tones: Record<Tone, string> = {
  success: 'bg-[#ecfdf3] text-[#067647]',
  danger: 'bg-[#fef3f2] text-[#b42318]',
  warning: 'bg-[#fef0c7] text-[#b54708]',
  neutral: 'bg-[#f2f4f7] text-[#475467]',
  info: 'bg-[#eff8ff] text-[#175cd3]',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Zone/record status → badge tone (doc 19 §2 status mapping). */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'ACTIVE':
    case 'DELIVERED':
    case 'PAID':
    case 'VERIFIED':
      return 'success';
    case 'INACTIVE':
    case 'CANCELLED':
    case 'SUSPENDED':
    case 'FAILED':
      return 'danger';
    case 'UPCOMING':
    case 'PENDING':
    case 'PREPARING':
      return 'warning';
    default:
      return 'neutral';
  }
}
