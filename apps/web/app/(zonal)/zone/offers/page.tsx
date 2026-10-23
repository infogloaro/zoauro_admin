import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OffersPage } from '../../../../features/offers/OffersPage';
import { offerPageProps } from '../../../../features/offers/offer-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Offers & Coupons · ZOAURO Admin' };

/** The layout has checked the session and the role. A member who may view offers nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = offerPageProps(me);
  if (p.viewZones.length === 0) notFound();
  return <OffersPage {...p} />;
}
