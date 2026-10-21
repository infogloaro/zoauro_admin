import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SupportPage } from '../../../../features/support/SupportPage';
import { supportPageProps } from '../../../../features/support/support-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Support Tickets · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may view tickets nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = supportPageProps(me);
  if (p.myZones.length === 0) notFound();
  return <SupportPage {...p} />;
}
