import type { Metadata } from 'next';
import { ProfileEditorPage } from '../../../../../../features/access/profiles/ProfileEditorPage';

export const metadata: Metadata = { title: 'Access profile · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API answers 404 for an unknown profile. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileEditorPage id={id} />;
}
