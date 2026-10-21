import type { Metadata } from 'next';
import { SuperAdminsPage } from '../../../../features/access/super-admins/SuperAdminsPage';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Super Admins · ZOAURO Admin' };

/**
 * The layout has already checked the session and the role (admins:* is Super Admin only, never grantable). Only a
 * primary Super Admin is offered the writes (D178); the API refuses the others with 403 PRIMARY_ONLY anyway.
 */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <SuperAdminsPage meIsPrimary={me.controlAreas?.isPrimary === true} />;
}
