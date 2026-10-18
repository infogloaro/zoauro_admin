import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NotificationDetailPage } from '../../../../../features/notifications/NotificationDetailPage';
import { notificationPageProps } from '../../../../../features/notifications/notification-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Notification · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One notification; the API answers 404 outside the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = notificationPageProps(me);
  if (!UUID.test(id) || (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0)) notFound();
  return <NotificationDetailPage id={id} role={p.role} myZones={p.myZones} can={p.can} />;
}
