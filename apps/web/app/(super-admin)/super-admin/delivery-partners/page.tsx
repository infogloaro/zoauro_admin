import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { DeliveryPartnersScreen } from '../../../../features/delivery-partners/delivery-partners-screen';

export const metadata: Metadata = {
  title: 'Own Delivery Partners · ZOAURO Admin',
};

export default function DeliveryPartnersPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <DeliveryPartnersScreen />
    </Suspense>
  );
}
