import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RefundDetailPage } from '../../../../../features/refunds/RefundDetailPage';
import { refundPageProps } from '../../../../../features/refunds/refund-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Refunds · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One record; the API answers 404 outside the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = refundPageProps(me, 'refunds');
  if (!UUID.test(id) || p.myZones.length === 0) notFound();
  return <RefundDetailPage id={id} {...p} />;
}
