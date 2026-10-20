import type { Metadata } from 'next';
import { ZoneTeamsPage } from '../../../../../features/access/teams/ZoneTeamsPage';

export const metadata: Metadata = { title: 'Zone teams · ZOAURO Admin' };

/** The layout has already checked the session and the role (access:* is Super Admin only). */
export default function Page() {
  return <ZoneTeamsPage />;
}
