import type { Metadata } from 'next';
import { StatusPage } from '../../../../components/shell/StatusPage';

export const metadata: Metadata = { title: 'Zone Management · ZOAURO Admin' };

/** Zone Management is live in the API (P11); its screens are the next step of this release (P16). */
export default function Page() {
  return (
    <StatusPage title="Zone Management">
      The zone list, the Add/Edit form and the activate and deactivate dialogs are being built in
      this release. Until they are here, no zone data is shown on this page.
    </StatusPage>
  );
}
