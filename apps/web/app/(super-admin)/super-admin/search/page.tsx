import type { Metadata } from 'next';
import { SearchPage } from '../../../../features/search/SearchPage';

export const metadata: Metadata = { title: 'Global Search · ZOAURO Admin' };

/** The layout has checked the session and the role; the API scopes every group (D143). */
export default function Page() {
  return <SearchPage userRole="SUPER_ADMIN" showZone />;
}
