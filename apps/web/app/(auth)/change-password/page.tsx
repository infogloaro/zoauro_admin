import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ForcedPasswordChange } from '../../../features/auth/ForcedPasswordChange';
import { getMe } from '../../../lib/server-session';

export const metadata: Metadata = { title: 'Change your password · ZOAURO Admin' };
export const dynamic = 'force-dynamic';

/**
 * The forced first-login change (doc 52 section 2.1 [3]): the session is restricted until the password is changed, so
 * this screen has no shell. Without a pending change the normal place is Account security.
 */
export default async function Page() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (!me.mustChangePassword) redirect('/account/security');
  return <ForcedPasswordChange csrfToken={me.csrfToken} name={me.user.name} />;
}
