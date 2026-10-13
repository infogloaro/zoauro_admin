import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { VendorsScreen } from '../../../../features/vendors/vendors-screen';

export const metadata: Metadata = {
  title: 'Restaurants · ZOAURO Admin',
};

export default function RestaurantsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <VendorsScreen />
    </Suspense>
  );
}
