import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlansPage } from '../../../../features/plans/PlansPage';
import { planPageProps } from '../../../../features/plans/plan-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Vendor plans · ZOAURO Admin' };

/** The layout has checked the session and the role. A member who may view plans nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = planPageProps(me);
  if (p.myZones.length === 0) notFound();
  return <PlansPage {...p} />;
}
