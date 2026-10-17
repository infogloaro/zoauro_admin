import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { MenuItemsScreen } from '../../../../features/menu-items/menu-items-screen';

export const metadata: Metadata = {
  title: 'Menu / Food Items · ZOAURO Admin',
};

export default function MenuItemsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <MenuItemsScreen />
    </Suspense>
  );
}
