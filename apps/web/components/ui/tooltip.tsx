'use client';

import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style Tooltip on Radix. Only put it on something focusable: a tooltip on plain text is invisible to keyboards.

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-md',
          'dark:bg-neutral-100 dark:text-neutral-900',
          className,
        )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
