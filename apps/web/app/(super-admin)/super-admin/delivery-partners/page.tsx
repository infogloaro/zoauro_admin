import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PartnersPage } from '../../../../features/partners/PartnersPage';
import { partnerPageProps } from '../../../../features/partners/partner-page-props';
import { canExportList } from '../../../../lib/export-access';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Delivery partners · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view partners anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = partnerPageProps(me);
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return (
    <PartnersPage
      role={p.role}
      myZones={p.myZones}
      canAdd={p.canAdd}
      canExport={canExportList(me, 'delivery')}
    />
  );
}
