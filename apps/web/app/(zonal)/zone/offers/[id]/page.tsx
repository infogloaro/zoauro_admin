import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OfferDetailPage } from '../../../../../features/offers/OfferDetailPage';
import { offerPageProps } from '../../../../../features/offers/offer-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Offer · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An offer of the member's offers:view zones (or every zone); the API answers 404 for any other. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = offerPageProps(me);
  if (!UUID.test(id) || p.viewZones.length === 0) notFound();
  return <OfferDetailPage id={id} {...p} />;
}
