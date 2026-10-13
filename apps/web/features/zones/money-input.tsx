'use client';

import { useEffect, useState } from 'react';
import { Input } from '../../components/ui/input';

/** paise → rupee text ("4900" → "49", "4950" → "49.50"). */
export function paiseToRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}

/** Rupee text → integer paise, or null when unparseable (string math, no floats). */
export function rupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fraction = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
  const paise = rupees * 100 + fraction;
  return paise > 2_147_483_647 ? null : paise;
}

/**
 * MoneyInput (doc 22 §5): paise-safe — the form keeps integer paise, the user
 * types rupees. No float multiplication anywhere.
 */
export function MoneyInput({
  id,
  value,
  onValueChange,
  onInvalid,
  disabled,
}: {
  id?: string;
  value: number;
  onValueChange: (paise: number) => void;
  onInvalid: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => paiseToRupees(value));

  useEffect(() => {
    const parsed = rupeesToPaise(text);
    if (parsed !== value) setText(paiseToRupees(value));
  }, [value]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
        ₹
      </span>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder="0"
        aria-label="Delivery charge in rupees"
        className="pl-7"
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const paise = rupeesToPaise(raw);
          if (paise === null) onInvalid();
          else onValueChange(paise);
        }}
      />
    </div>
  );
}
