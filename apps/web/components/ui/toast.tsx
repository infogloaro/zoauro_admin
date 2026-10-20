'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

// Toasts for results (AGENTS.md UI rules, doc 19): a dark card bottom-right, like the owner's prototype. Announced to
// assistive technology through a polite live region (errors: assertive). Each closes itself after a few seconds and has
// a close button. Use for the outcome of an action, never as the only place an error is explained.

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  toast: (t: { tone?: ToastTone; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const ICON_TONE = {
  success: 'text-green-400',
  error: 'text-red-400',
  info: 'text-sky-400',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const toast = useCallback<ToastApi['toast']>(
    ({ tone = 'success', title, description }) => {
      const id = next.current++;
      setItems((all) => [
        ...all.slice(-3),
        { id, tone, title, ...(description ? { description } : {}) },
      ]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {items
            .filter((t) => t.tone !== 'error')
            .map((t) => `${t.title}${t.description ? `. ${t.description}` : ''}`)
            .join('. ')}
        </div>
        <div aria-live="assertive" aria-atomic="true" className="sr-only">
          {items
            .filter((t) => t.tone === 'error')
            .map((t) => `${t.title}${t.description ? `. ${t.description}` : ''}`)
            .join('. ')}
        </div>
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              aria-hidden
              className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl bg-[#111827] px-4 py-3 text-sm text-white shadow-pop"
            >
              <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[t.tone])} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.title}</p>
                {t.description ? (
                  <p className="mt-0.5 text-xs text-gray-300">{t.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-gray-400 hover:text-white"
                aria-label="Dismiss"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Toasts from anywhere under <ToastProvider>; outside it (isolated component tests) a no-op. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { toast: () => undefined };
}
