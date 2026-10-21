import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RefundsPage } from '../../../../features/refunds/RefundsPage';
import { refundPageProps } from '../../../../features/refunds/refund-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Refunds · ZOAURO Admin' };

/** The layout has checked the session and the role. A member who may view refunds nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = refundPageProps(me, 'refunds');
  if (p.myZones.length === 0) notFound();
  return <RefundsPage {...p} />;
}
