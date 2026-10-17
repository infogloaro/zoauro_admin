import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TableSkeleton } from '../../../../components/shared/states';
import { HotelsScreen } from '../../../../features/hotels/hotels-screen';

export const metadata: Metadata = {
  title: 'Hotel Room Booking · ZOAURO Admin',
};

export default function HotelRoomBookingPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[--radius-card] border border-border bg-surface">
          <TableSkeleton />
        </div>
      }
    >
      <HotelsScreen />
    </Suspense>
  );
}
