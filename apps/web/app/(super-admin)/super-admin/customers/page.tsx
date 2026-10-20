import type { Metadata } from 'next';
import { CustomersPage } from '../../../../features/customers/CustomersPage';
import { customerPageProps } from '../../../../features/customers/customer-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Customers · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <CustomersPage {...customerPageProps(me)} />;
}
