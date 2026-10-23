import type { Metadata } from 'next';
import { OffersPage } from '../../../../features/offers/OffersPage';
import { offerPageProps } from '../../../../features/offers/offer-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Offers & Coupons · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <OffersPage {...offerPageProps(me)} />;
}
