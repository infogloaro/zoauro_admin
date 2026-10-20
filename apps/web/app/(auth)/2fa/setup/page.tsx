import type { Metadata } from 'next';
import { SetupWizard } from '../../../../features/auth/SetupWizard';

export const metadata: Metadata = { title: 'Set up 2-step verification · ZOAURO Admin' };

export default function Page() {
  return <SetupWizard />;
}
