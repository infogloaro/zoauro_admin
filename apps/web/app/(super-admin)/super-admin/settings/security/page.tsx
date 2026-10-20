import type { Metadata } from 'next';
import { SecuritySettings } from '../../../../../features/settings/SecuritySettings';

export const metadata: Metadata = { title: 'Security settings · ZOAURO Admin' };

/** The layout has already checked the session and the role (settings:* is never grantable to a Zonal Admin). */
export default function Page() {
  return <SecuritySettings />;
}
