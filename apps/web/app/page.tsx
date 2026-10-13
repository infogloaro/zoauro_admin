import { redirect } from 'next/navigation';
import { homeFor } from '../lib/navigation';
import { getMe } from '../lib/server-session';

// `/`: role routing (doc 18 section 1). Signed out: the login page; otherwise the role's own dashboard.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect('/login');
  redirect(homeFor(me.user.role, me.permissions.global ? [] : me.permissions.zones));
}
