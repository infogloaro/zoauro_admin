'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';

// 6-cell code input (doc 52 section 9.2 and 9.7): numeric keypad on mobile, autocomplete="one-time-code" (SMS and
// password-manager autofill), paste fills every cell, backspace walks back, and the sixth digit submits. Cells fill in
// order, so the value is always a prefix of digits. It never submits an empty or partial code.

export const OTP_LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  focusFirst = false,
  describedBy,
  label = 'Verification code',
}: {
  value: string;
  onChange: (value: string) => void;
  /** called once when the sixth digit arrives */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** focus the first cell when shown: the screen exists to type this code (doc 52 section 9.2) */
  focusFirst?: boolean;
  describedBy?: string;
  label?: string;
}) {
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => cells.current[Math.max(0, Math.min(OTP_LENGTH - 1, i))]?.focus();
  // the value as just changed: focus moves before the parent re-renders, and the focused cell's check must see it
  const latest = useRef(value);
  latest.current = value;
  const change = (next: string) => {
    latest.current = next;
    onChange(next);
  };

  /** Puts `typed` digits into the cells from `at` on (never past the first empty cell). */
  function fill(at: number, typed: string) {
    const digits = typed.replace(/\D/g, '');
    if (!digits) return;
    const start = Math.min(at, value.length);
    const next = (value.slice(0, start) + digits).slice(0, OTP_LENGTH);
    change(next);
    focus(next.length);
    if (next.length === OTP_LENGTH && value.length < OTP_LENGTH) onComplete?.(next);
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      // a filled cell clears itself (and anything after it); an empty one clears the previous cell
      const cut = i < value.length ? i : Math.max(0, i - 1);
      change(value.slice(0, cut));
      focus(cut);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(Math.min(i + 1, value.length));
    }
  }

  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    fill(i, e.clipboardData.getData('text'));
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn('flex gap-2', invalid && 'animate-shake')}
    >
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            cells.current[i] = el;
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the code screen exists to type this code (doc 52 9.2)
          autoFocus={focusFirst && i === 0}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? OTP_LENGTH : 2}
          aria-label={`${label}, digit ${i + 1} of ${OTP_LENGTH}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={value[i] ?? ''}
          onFocus={() => {
            // cells fill in order: focusing a later empty cell moves to the first empty one
            if (i > latest.current.length) focus(latest.current.length);
          }}
          onChange={(e) => {
            const raw = e.target.value;
            const current = value[i] ?? '';
            // typing into a filled cell gives two characters: keep the new one
            const typed =
              current && raw.length === 2 && raw.includes(current) ? raw.replace(current, '') : raw;
            fill(i, typed);
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          className={cn(
            'size-11 rounded-input border border-line bg-surface text-center text-lg font-semibold tabular-nums',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            'aria-[invalid=true]:border-danger disabled:opacity-60',
          )}
        />
      ))}
    </div>
  );
}
