import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ModulePlan } from '../../../../components/shell/ModulePlan';
import { comingSoonModule, homeFor } from '../../../../lib/navigation';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Coming soon · ZOAURO Admin' };

/** One plan page per module that is not built yet. A module this person could not see is 404. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me) notFound();
  const zones = me.permissions.global ? [] : me.permissions.zones;
  const mod = comingSoonModule(slug, me.user.role, zones);
  if (!mod) notFound();
  return <ModulePlan mod={mod} homeHref={homeFor(me.user.role, zones)} />;
}
