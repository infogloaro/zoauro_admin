import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TicketDetailPage } from '../../../../../features/support/TicketDetailPage';
import { supportPageProps } from '../../../../../features/support/support-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Support Tickets · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ticket; the API answers 404 for a ticket that does not exist. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  if (!UUID.test(id)) notFound();
  return <TicketDetailPage id={id} {...supportPageProps(me)} />;
}
