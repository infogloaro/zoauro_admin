import type { MeResponse } from '@zoauro/shared';
import type { Metadata } from 'next';
import { HotelsPage } from '../../../../features/hotels/HotelsPage';
import { hotelPageProps } from '../../../../features/hotels/hotel-page-props';
import { canExportList } from '../../../../lib/export-access';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Hotels & Bookings · ZOAURO Admin' };

const hotelExports = (me: MeResponse) => ({
  hotels: canExportList(me, 'hotels'),
  bookings: canExportList(me, 'bookings'),
  dining: canExportList(me, 'dining'),
});

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <HotelsPage {...hotelPageProps(me)} canExport={hotelExports(me)} />;
}
