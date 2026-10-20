import type { Metadata } from 'next';
import { AccessHistoryPage } from '../../../../../features/access/history/AccessHistoryPage';

export const metadata: Metadata = { title: 'Access change history · ZOAURO Admin' };

/** The layout has already checked the session and the role (access:* is Super Admin only). */
export default function Page() {
  return <AccessHistoryPage />;
}
