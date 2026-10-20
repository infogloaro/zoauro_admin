import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelDetailPage } from '../../../../../features/hotels/HotelDetailPage';
import { hotelPageProps } from '../../../../../features/hotels/hotel-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Hotels & Bookings · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One hotel; the API answers 404 for a hotel outside the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = hotelPageProps(me);
  if (!UUID.test(id) || !p.views.includes('hotels')) notFound();
  return <HotelDetailPage id={id} {...p} />;
}
