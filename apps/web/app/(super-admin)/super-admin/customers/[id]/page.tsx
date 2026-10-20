import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomerDetailPage } from '../../../../../features/customers/CustomerDetailPage';
import { customerPageProps } from '../../../../../features/customers/customer-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Customers · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One customer; the API answers 404 for a customer that does not exist. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  if (!UUID.test(id)) notFound();
  return <CustomerDetailPage id={id} {...customerPageProps(me)} />;
}
