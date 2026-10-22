import type { Metadata } from 'next';
import { ControlPanelPage } from '../../../../features/control-panel/ControlPanelPage';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Control Panel · ZOAURO Admin' };

/**
 * The layout has already checked the session and the role (zone services are Super Admin only, D92). D178: the
 * controls follow the member's Control Panel areas.
 */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <ControlPanelPage areas={me.controlAreas} />;
}
