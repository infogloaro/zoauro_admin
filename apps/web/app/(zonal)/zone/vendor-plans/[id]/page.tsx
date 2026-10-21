import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlanDetailPage } from '../../../../../features/plans/PlanDetailPage';
import { planPageProps } from '../../../../../features/plans/plan-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Vendor plans · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One active plan; the API answers 404 for any other, and lists only the vendors of the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = planPageProps(me);
  if (!UUID.test(id) || p.myZones.length === 0) notFound();
  return <PlanDetailPage id={id} {...p} />;
}
