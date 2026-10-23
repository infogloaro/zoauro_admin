import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OfferDetailPage } from '../../../../../features/offers/OfferDetailPage';
import { offerPageProps } from '../../../../../features/offers/offer-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Offer · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The layout has checked the session and the role. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  if (!UUID.test(id)) notFound();
  return <OfferDetailPage id={id} {...offerPageProps(me)} />;
}
