import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone: 'blue' | 'info' | 'success' | 'danger' | 'warning';
}) {
  const toneClass = {
    blue: 'bg-[#dbeafe] text-[#2563eb]',
    info: 'bg-[#ede9fe] text-[#7c3aed]',
    success: 'bg-[#dcfce7] text-[#16a34a]',
    danger: 'bg-[#fee2e2] text-[#dc2626]',
    warning: 'bg-[#fef3c7] text-[#f59e0b]',
  }[tone];

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${toneClass}`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{label}</p>
          <p className="mt-1 text-3xl font-bold leading-tight text-text">{value}</p>
        </div>
      </div>
    </div>
  );
}
