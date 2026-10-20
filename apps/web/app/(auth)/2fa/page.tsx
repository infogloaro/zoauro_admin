import type { Metadata } from 'next';
import { TwoStepVerify } from '../../../features/auth/TwoStepVerify';

export const metadata: Metadata = { title: 'Two-step verification · ZOAURO Admin' };

export default function Page() {
  return <TwoStepVerify />;
}
