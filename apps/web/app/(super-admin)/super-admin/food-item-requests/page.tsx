import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FoodItemRequestsPage } from '../../../../features/menu/FoodItemRequestsPage';
import { menuPageProps } from '../../../../features/menu/menu-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Food item requests · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view menus anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = menuPageProps(me);
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <FoodItemRequestsPage role={p.role} myZones={p.myZones} canDecide={p.can.status} />;
}
