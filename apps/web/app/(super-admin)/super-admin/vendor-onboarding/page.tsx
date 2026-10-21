import type { Metadata } from 'next';
import { OnboardingPage } from '../../../../features/onboarding/OnboardingPage';
import { onboardingPageProps } from '../../../../features/onboarding/onboarding-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Vendor Onboarding · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <OnboardingPage {...onboardingPageProps(me)} />;
}
