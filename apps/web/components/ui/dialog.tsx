'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style centred Dialog on Radix: focus trap, Escape closes, focus returns to the opener. Used for confirmations
// and the re-authentication step (doc 52 section 9.4).

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  className,
  children,
  closeLabel = 'Close',
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <RadixDialog.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
          'flex-col gap-4 overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-xl',
          className,
        )}
        {...props}
      >
        {children}
        <RadixDialog.Close
          className="absolute top-4 right-4 rounded-input p-1 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={closeLabel}
        >
          <X aria-hidden className="size-4" />
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={cn('pr-8 text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Description>) {
  return <RadixDialog.Description className={cn('text-sm text-muted', className)} {...props} />;
}
