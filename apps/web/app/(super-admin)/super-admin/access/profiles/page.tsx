import type { Metadata } from 'next';
import { ProfilesPage } from '../../../../../features/access/profiles/ProfilesPage';

export const metadata: Metadata = { title: 'Access profiles · ZOAURO Admin' };

/** The layout has already checked the session and the role (access:* is Super Admin only). */
export default function Page() {
  return <ProfilesPage />;
}
