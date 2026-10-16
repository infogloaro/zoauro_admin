import type { Metadata } from 'next';
import { PlatformSettingsPage } from '../../../../../features/platform-settings/PlatformSettingsPage';

export const metadata: Metadata = { title: 'Platform settings · ZOAURO Admin' };

/** The layout has already checked the session and the role (settings:* is never grantable to a Zonal Admin). */
export default function Page() {
  return <PlatformSettingsPage />;
}
