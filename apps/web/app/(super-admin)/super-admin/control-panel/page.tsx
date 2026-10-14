import type { Metadata } from 'next';
import { ControlPanelPage } from '../../../../features/control-panel/ControlPanelPage';

export const metadata: Metadata = { title: 'Control Panel · ZOAURO Admin' };

/** The layout has already checked the session and the role (zone services are Super Admin only, D92). */
export default function Page() {
  return <ControlPanelPage />;
}
