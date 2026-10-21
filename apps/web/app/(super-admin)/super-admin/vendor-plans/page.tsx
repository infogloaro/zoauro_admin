import type { Metadata } from 'next';
import { PlansPage } from '../../../../features/plans/PlansPage';
import { planPageProps } from '../../../../features/plans/plan-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Vendor plans · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <PlansPage {...planPageProps(me)} />;
}
