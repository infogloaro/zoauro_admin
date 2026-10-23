import type { Metadata } from 'next';
import { AdSlotsPage } from '../../../../../features/ads/AdSlotsPage';
import { adsPageProps } from '../../../../../features/ads/ads-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Ad slots · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <AdSlotsPage {...adsPageProps(me)} />;
}
