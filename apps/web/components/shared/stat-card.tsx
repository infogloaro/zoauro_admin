import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * KPI card (Figma "Restaurant Management" overview): uniform orange icon tile
 * on the left, label / value / supporting caption stacked on the right, with
 * the reference's slate typography (32/15/13/12 scale). The `tone` prop is
 * kept for call-site compatibility but no longer tints the card. Hover
 * highlights the card in the theme orange (border + light tint + subtle
 * shadow, 200 ms); the orange focus-visible ring mirrors the global
 * `*:focus-visible` outline for keyboard users.
 */
export function StatCard({
  label,
  value,
  icon,
  caption,
  captionTone = 'muted',
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  caption?: ReactNode;
  captionTone?: 'success' | 'muted';
  tone?: 'blue' | 'info' | 'success' | 'danger' | 'warning';
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 transition-colors duration-200 hover:border-orange-300 hover:bg-orange-50/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] leading-snug text-slate-500">{label}</p>
        <p className="mt-1 text-[28px] font-bold leading-none text-slate-900">{value}</p>
        {caption && (
          <p
            className={cn(
              'mt-1.5 text-[12px] leading-snug',
              captionTone === 'success' ? 'text-green-600' : 'text-slate-500',
            )}
          >
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}
