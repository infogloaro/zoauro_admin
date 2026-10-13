import type { Metadata } from 'next';
import { StatusPage } from '../../../../components/shell/StatusPage';

export const metadata: Metadata = { title: 'Account security · ZOAURO Admin' };

/** Password, 2-step verification and sessions work in the API (P6–P10); their screens come with the sign-in screens (P15). */
export default function Page() {
  return (
    <StatusPage title="Account security">
      Changing your password, 2-step verification, backup codes and your signed-in sessions are
      being built in this release, together with the sign-in screens.
    </StatusPage>
  );
}
