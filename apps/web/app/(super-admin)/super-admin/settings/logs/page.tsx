import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SystemLogsPage } from '../../../../../features/audit/logs/SystemLogsPage';
import { getSessionUser, superAdminGate } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'System Logs · ZOAURO Admin' };
// the answer depends on the visitor's cookie: never cache it
export const dynamic = 'force-dynamic';

const PATH = '/super-admin/settings/logs';

/** Super Admin only. No session: sign in first. Any other member: 404, as if the page did not exist. */
export default async function Page() {
  const gate = superAdminGate(await getSessionUser());
  if (gate === 'login') redirect(`/login?next=${encodeURIComponent(PATH)}`);
  if (gate === 'not-found') notFound();
  return <SystemLogsPage />;
}
