import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { ZonesScreen } from '../../../../features/zones/zones-screen';

export const metadata: Metadata = {
  title: 'Zone Management · ZOAURO Admin',
};

export default function ZonesPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <ZonesScreen />
    </Suspense>
  );
}
