import type { Metadata } from 'next';
import { PayoutsPage } from '../../../../features/settlements/PayoutsPage';
import { settlementPageProps } from '../../../../features/settlements/settlement-page-props';
import { canExportList } from '../../../../lib/export-access';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Payouts · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = settlementPageProps(me, 'payouts');
  return <PayoutsPage {...p} canExport={canExportList(me, 'payouts')} />;
}
