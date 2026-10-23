import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AdRequestsPage } from '../../../../../features/ads/AdRequestsPage';
import { adsPageProps } from '../../../../../features/ads/ads-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Ad requests · ZOAURO Admin' };

/** The layout has checked the session and the role. A member who may view ads nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = adsPageProps(me);
  if (p.myZones.length === 0) notFound();
  return <AdRequestsPage {...p} />;
}
