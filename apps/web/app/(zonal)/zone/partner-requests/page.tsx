import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PartnersPage } from '../../../../features/partners/PartnersPage';
import { partnerPageProps } from '../../../../features/partners/partner-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Delivery partner requests · ZOAURO Admin' };

/** R12: the partners waiting for verification (the same list, filtered). */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = partnerPageProps(me);
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <PartnersPage role={p.role} myZones={p.myZones} canAdd={false} mode="requests" />;
}
