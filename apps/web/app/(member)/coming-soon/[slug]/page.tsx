import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatusPage, linkButton } from '../../../../components/shell/StatusPage';
import { comingSoonModule } from '../../../../lib/navigation';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Coming soon · ZOAURO Admin' };

/** One explanation page per module that is not built yet. A module this person could not see is 404. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getMe();
  if (!me) notFound();
  const zones = me.permissions.global ? [] : me.permissions.zones;
  const mod = comingSoonModule(slug, me.user.role, zones);
  if (!mod) notFound();
  return (
    <StatusPage
      code="Coming Soon"
      title={mod.label}
      actions={
        <a href="/" className={linkButton}>
          Back to the dashboard
        </a>
      }
    >
      <p>{mod.description}</p>
      <p className="mt-3 font-medium text-text">Not available in this release.</p>
    </StatusPage>
  );
}
