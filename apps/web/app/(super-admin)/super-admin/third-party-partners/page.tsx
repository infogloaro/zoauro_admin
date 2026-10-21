import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { ThirdPartyPartnersScreen } from '../../../../features/third-party-partners/third-party-partners-screen';

export const metadata: Metadata = {
  title: 'Third-Party Partners · ZOAURO Admin',
};

export default function ThirdPartyPartnersPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <ThirdPartyPartnersScreen />
    </Suspense>
  );
}
