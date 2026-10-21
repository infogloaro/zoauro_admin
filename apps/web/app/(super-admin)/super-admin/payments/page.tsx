import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { PaymentsScreen } from '../../../../features/payments/payments-screen';
export const metadata: Metadata = { title: 'Payments · ZOAURO Admin' };

export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <PaymentsScreen />
    </Suspense>
  );
}
