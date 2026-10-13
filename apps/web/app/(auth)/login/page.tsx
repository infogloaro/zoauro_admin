import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '../../../features/auth/LoginForm';
import { homeFor } from '../../../lib/navigation';
import { CHANGE_PASSWORD_PATH, safeNext } from '../../../lib/redirects';
import { getMe } from '../../../lib/server-session';

export const metadata: Metadata = { title: 'Sign in · ZOAURO Admin' };
export const dynamic = 'force-dynamic';

/** Already signed in: straight on (a pending password change first). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)['next'];
  const next = safeNext(typeof raw === 'string' ? raw : null) ?? undefined;
  const me = await getMe();
  if (me) {
    if (me.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
    redirect(next ?? homeFor(me.user.role, me.permissions.global ? [] : me.permissions.zones));
  }
  return <LoginForm next={next} />;
}
