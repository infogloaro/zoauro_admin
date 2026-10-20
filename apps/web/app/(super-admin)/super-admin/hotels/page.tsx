import type { Metadata } from 'next';
import { HotelsPage } from '../../../../features/hotels/HotelsPage';
import { hotelPageProps } from '../../../../features/hotels/hotel-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Hotels & Bookings · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <HotelsPage {...hotelPageProps(me)} />;
}
