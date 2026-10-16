import type { Metadata } from 'next';
import { SettingsHistoryPage } from '../../../../../features/platform-settings/SettingsHistoryPage';

export const metadata: Metadata = { title: 'Settings history · ZOAURO Admin' };

/** The layout has already checked the session and the role (settings:* is never grantable to a Zonal Admin). */
export default function Page() {
  return <SettingsHistoryPage />;
}
