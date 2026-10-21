import type { Metadata } from 'next';
import { PlatformSettingsPage } from '../../../../../features/platform-settings/PlatformSettingsPage';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Platform settings · ZOAURO Admin' };

/**
 * The layout has already checked the session and the role (settings:* is never grantable to a Zonal Admin). D178: a
 * non-primary Super Admin sees only the settings groups granted to them; the API refuses the others anyway.
 */
export default async function Page() {
  const me = await getMe();
  const ca = me?.controlAreas;
  return <PlatformSettingsPage areas={ca && !ca.isPrimary ? ca.areas : null} />;
}
