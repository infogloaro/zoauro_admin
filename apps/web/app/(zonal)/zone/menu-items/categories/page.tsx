import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CategoriesPage } from '../../../../../features/menu/CategoriesPage';
import { menuPageProps } from '../../../../../features/menu/menu-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Menu categories · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view menus anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = menuPageProps(me);
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <CategoriesPage role={p.role} myZones={p.myZones} can={p.can} />;
}
