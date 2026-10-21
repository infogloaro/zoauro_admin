import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CodSettlementPage } from '../../../../features/settlements/CodSettlementPage';
import { settlementPageProps } from '../../../../features/settlements/settlement-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'COD cash settlement · ZOAURO Admin' };

/** The layout has checked the session and the role. A member who may view settlements nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = settlementPageProps(me, 'settlements');
  if (p.myZones.length === 0) notFound();
  return <CodSettlementPage {...p} />;
}
