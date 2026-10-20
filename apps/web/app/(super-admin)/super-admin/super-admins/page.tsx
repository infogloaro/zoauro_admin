import type { Metadata } from 'next';
import { SuperAdminsPage } from '../../../../features/access/super-admins/SuperAdminsPage';

export const metadata: Metadata = { title: 'Super Admins · ZOAURO Admin' };

/** The layout has already checked the session and the role (admins:* is Super Admin only, never grantable). */
export default function Page() {
  return <SuperAdminsPage />;
}
