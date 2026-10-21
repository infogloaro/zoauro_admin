import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnboardingPage } from '../../../../features/onboarding/OnboardingPage';
import { onboardingPageProps } from '../../../../features/onboarding/onboarding-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Vendor Onboarding · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may view no vendor module anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = onboardingPageProps(me);
  if (p.myZones.length === 0) notFound();
  return <OnboardingPage {...p} />;
}
