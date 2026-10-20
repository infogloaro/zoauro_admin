import type { Metadata } from 'next';
import { ZonesPage } from '../../../../features/zones/ZonesPage';

export const metadata: Metadata = { title: 'Zone Management · ZOAURO Admin' };

/** The layout has already checked the session and the role (zones:* is Super Admin only). */
export default function Page() {
  return <ZonesPage />;
}
