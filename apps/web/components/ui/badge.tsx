import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const tones: Record<Tone, string> = {
  success: 'bg-[#dcfce7] text-[#15803d]',
  danger: 'bg-[#fee2e2] text-[#b91c1c]',
  warning: 'bg-[#fef3c7] text-[#b45309]',
  neutral: 'bg-[#f3f4f6] text-[#4b5563]',
  info: 'bg-[#dbeafe] text-[#1d4ed8]',
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
