import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PayoutDetailPage } from '../../../../../features/settlements/PayoutDetailPage';
import { settlementPageProps } from '../../../../../features/settlements/settlement-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Payout · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One payout (D203); the API answers 404 for a payout outside the member's payouts:view zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = settlementPageProps(me, 'payouts');
  if (!UUID.test(id) || (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0)) notFound();
  return <PayoutDetailPage id={id} role={p.role} canMarkPaid={p.canMarkPaid ?? false} />;
}
