import type { Metadata } from 'next';
import { RecentActivities } from '../../../../features/dashboard/RecentActivities';

export const metadata: Metadata = { title: 'Recent Activities · ZOAURO Admin' };

/** The layout has already checked the session and the role (audit:view is Super Admin only). */
export default function Page() {
  return <RecentActivities />;
}
