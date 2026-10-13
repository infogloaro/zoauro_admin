'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// shadcn-style Tabs on Radix: arrow keys move between tabs, Home/End jump, the active panel is the only one mounted.

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
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
        '-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium whitespace-nowrap text-muted',
        'hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        'data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-primary-strong',
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
