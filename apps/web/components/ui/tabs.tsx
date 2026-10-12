'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style Tabs on Radix: arrow keys move between tabs, Home/End jump, the active panel is the only one mounted.

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex gap-1 border-b border-neutral-200 dark:border-neutral-800', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-neutral-600',
        'hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
        'data-[state=active]:border-neutral-900 data-[state=active]:text-neutral-900',
        'dark:text-neutral-400 dark:hover:text-neutral-100',
        'dark:data-[state=active]:border-neutral-100 dark:data-[state=active]:text-neutral-100',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content className={cn('pt-4 focus-visible:outline-none', className)} {...props} />
  );
}
