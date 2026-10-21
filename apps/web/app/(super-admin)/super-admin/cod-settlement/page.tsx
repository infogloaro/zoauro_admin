import type { Metadata } from 'next';
import { CodSettlementPage } from '../../../../features/cod-settlement/CodSettlementPage';
import { codPageProps } from '../../../../features/cod-settlement/page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'COD Cash Settlement · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <CodSettlementPage {...codPageProps(me)} />;
}
