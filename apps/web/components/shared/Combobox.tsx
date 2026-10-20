'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { CONTROL_CLASS } from './FilterBar';

// Typeahead (WAI-ARIA combobox with a listbox popup, list autocomplete). The caller owns the suggestions: it listens to
// onInputChange (debounce there), and passes `options` back. Choosing an option calls onSelect; the clear button calls
// onSelect(null). Keys: ArrowDown/ArrowUp move, Enter chooses, Escape closes.

export interface ComboOption {
  id: string;
  label: string;
  /** secondary text, e.g. a role */
  hint?: string;
}

export function Combobox({
  id,
  value,
  options,
  loading = false,
  placeholder,
  onInputChange,
  onSelect,
}: {
  id: string;
  value: ComboOption | null;
  options: ComboOption[];
  loading?: boolean;
  placeholder?: string;
  onInputChange: (text: string) => void;
  onSelect: (option: ComboOption | null) => void;
}) {
  const listId = useId();
  const [text, setText] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);

  // the selection changed from outside (Reset, a drawer shortcut): show it
  useEffect(() => {
    setText(value?.label ?? '');
  }, [value?.id, value?.label]);

  const choose = (o: ComboOption) => {
    setText(o.label);
    setOpen(false);
    setActive(-1);
    onSelect(o);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget)) {
          setOpen(false);
          setText(value?.label ?? ''); // leaving with half-typed text keeps the real selection
        }
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        className={cn(CONTROL_CLASS, value && 'pr-8')}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          onInputChange(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          onInputChange(text === value?.label ? '' : text);
        }}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            setText('');
            onSelect(null);
          }}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-neutral-500 hover:text-neutral-900 focus-visible:outline-2 dark:hover:text-neutral-100"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        hidden={!open}
        className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
      >
        {options.map((o, i) => (
          <li
            key={o.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={value?.id === o.id}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} // keep focus in the input
            onClick={() => choose(o)}
            onKeyDown={(e) => e.key === 'Enter' && choose(o)}
            className={cn(
              'cursor-pointer px-2 py-1.5',
              i === active && 'bg-neutral-100 dark:bg-neutral-900',
            )}
          >
            {o.label}
            {o.hint ? (
              <>
                {/* without a separator the accessible name runs together: "Member 7Zonal Admin" */}
                <span className="sr-only">, </span>
                <span className="ml-2 text-xs text-neutral-600 dark:text-neutral-400">
                  {o.hint}
                </span>
              </>
            ) : null}
          </li>
        ))}
        {open && !loading && options.length === 0 ? (
          <li role="presentation" className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
            No matches
          </li>
        ) : null}
      </ul>
      <div role="status" className="sr-only">
        {open ? (loading ? 'Searching' : `${options.length} suggestions`) : ''}
      </div>
    </div>
  );
}
