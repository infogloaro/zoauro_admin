'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style Sheet on Radix Dialog: a panel from the right edge. Radix gives the focus trap, Escape to close, and
// returns focus to the element that had it before the sheet opened.

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  className,
  children,
  closeLabel = 'Close',
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Content> & { closeLabel?: string; children: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Dialog.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col gap-4 overflow-y-auto',
          'border-l border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-950',
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close
          className="absolute top-4 right-4 rounded p-1 text-neutral-500 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:text-neutral-100"
          aria-label={closeLabel}
        >
          <X aria-hidden className="size-4" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentPropsWithoutRef<typeof Dialog.Title>) {
  return <Dialog.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      className={cn('text-sm text-neutral-600 dark:text-neutral-400', className)}
      {...props}
    />
  );
}
