import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Container for a list's filters (doc 22 section 2): a labelled search region, the controls, and Reset. The controls own
// their URL state; this only lays them out.

export function FilterBar({
  label,
  onReset,
  children,
  className,
}: {
  label: string;
  onReset: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6',
        'items-end rounded-lg border border-neutral-200 p-3 dark:border-neutral-800',
        className,
      )}
    >
      {children}
      <button
        type="button"
        onClick={onReset}
        className="h-9 rounded-md border border-neutral-300 px-3 text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Reset
      </button>
    </div>
  );
}

/** A label above a control (doc 19 section 4: labels above fields). */
export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-neutral-600 dark:text-neutral-400"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const CONTROL_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-1';
