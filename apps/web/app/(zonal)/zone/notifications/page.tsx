import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NotificationsPage } from '../../../../features/notifications/NotificationsPage';
import { notificationPageProps } from '../../../../features/notifications/notification-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Notifications · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view notifications anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = notificationPageProps(me);
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <NotificationsPage role={p.role} myZones={p.myZones} canAdd={p.canAdd} />;
}
