import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { CustomersScreen } from '../../../../features/customers/customers-screen';

export const metadata: Metadata = {
  title: 'Customers · ZOAURO Admin',
};

export default function CustomersPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <CustomersScreen />
    </Suspense>
  );
}
