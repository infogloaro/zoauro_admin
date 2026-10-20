import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

// FormField (doc 22): a label, the control, an optional hint and the error. The control gets the id, aria-invalid and
// aria-describedby, so every input is labelled and its error is read with it (doc 52 section 9.7).

export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={className ?? 'flex flex-col gap-1.5'}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A form-level message (generic sign-in error, server failure): announced when it appears. */
export function FormAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    danger: 'border-danger/30 bg-red-50 text-danger',
    success: 'border-success/30 bg-green-50 text-success',
    info: 'border-primary/30 bg-blue-50 text-primary',
  }[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-input border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
