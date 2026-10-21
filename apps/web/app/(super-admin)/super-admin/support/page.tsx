import type { Metadata } from 'next';
import { SupportPage } from '../../../../features/support/SupportPage';
import { supportPageProps } from '../../../../features/support/support-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Support Tickets · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <SupportPage {...supportPageProps(me)} />;
}
