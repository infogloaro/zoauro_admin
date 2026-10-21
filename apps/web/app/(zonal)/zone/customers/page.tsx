import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomersPage } from '../../../../features/customers/CustomersPage';
import { customerPageProps } from '../../../../features/customers/customer-page-props';
import { canExportList } from '../../../../lib/export-access';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Customers · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may view customers nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = customerPageProps(me);
  if (p.myZones.length === 0) notFound();
  return <CustomersPage {...p} canExport={canExportList(me, 'customers')} />;
}
