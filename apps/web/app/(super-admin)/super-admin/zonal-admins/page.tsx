import type { Metadata } from 'next';
import { ZonalAdminsPage } from '../../../../features/access/admins/ZonalAdminsPage';

export const metadata: Metadata = { title: 'Zonal Admins · ZOAURO Admin' };

/** The layout has already checked the session and the role (admins:* is Super Admin only). */
export default function Page() {
  return <ZonalAdminsPage />;
}
